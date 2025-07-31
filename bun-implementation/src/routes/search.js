import db from '../database/connection.js';

export class SearchHandler {
    // GET /api/search - Search books with advanced filtering
    async search(request) {
        try {
            const url = new URL(request.url);
            const q = url.searchParams.get('q');
            const genre = url.searchParams.get('genre');
            const author = url.searchParams.get('author');
            const minPrice = url.searchParams.get('minPrice');
            const maxPrice = url.searchParams.get('maxPrice');
            const page = parseInt(url.searchParams.get('page')) || 1;
            const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);

            if (!q || q.trim().length === 0) {
                return Response.json({ error: 'Search query (q) is required' }, { status: 400 });
            }

            const pageNum = parseInt(page);
            const limitNum = Math.min(parseInt(limit) || 20, 100);
            const offset = (pageNum - 1) * limitNum;

            // Build dynamic query conditions safely
            let conditions = [];
            const searchTerm = q.trim();
            
            // Base search conditions
            conditions.push(db.sql`(
                b.title ILIKE ${'%' + searchTerm + '%'} OR 
                b.description ILIKE ${'%' + searchTerm + '%'} OR
                b.genre ILIKE ${'%' + searchTerm + '%'} OR
                a.name ILIKE ${'%' + searchTerm + '%'}
            )`);
            
            // Add filters
            if (genre) conditions.push(db.sql`b.genre ILIKE ${'%' + genre + '%'}`);
            if (author) conditions.push(db.sql`a.name ILIKE ${'%' + author + '%'}`);
            if (minPrice) conditions.push(db.sql`b.price >= ${parseFloat(minPrice)}`);
            if (maxPrice) conditions.push(db.sql`b.price <= ${parseFloat(maxPrice)}`);

            const whereClause = db.sql`WHERE ${db.sql.join(conditions, db.sql` AND `)}`;

            // Get total count for pagination
            const countResult = await db.sql`
                SELECT COUNT(*) as count
                FROM books b
                LEFT JOIN authors a ON b.author_id = a.id
                ${whereClause}
            `;
            const total = parseInt(countResult[0].count);

            // Get paginated results
            const result = await db.sql`
                SELECT b.*, a.name as author_name
                FROM books b
                LEFT JOIN authors a ON b.author_id = a.id
                ${whereClause}
                ORDER BY b.title ASC 
                LIMIT ${limitNum} OFFSET ${offset}
            `;

            // Get search suggestions for similar terms
            let suggestions = [];
            if (result.length === 0) {
                try {
                    const suggestionResult = await db.sql`
                        SELECT DISTINCT b.title, a.name as author_name, b.genre
                        FROM books b
                        LEFT JOIN authors a ON b.author_id = a.id
                        WHERE b.title ILIKE ${'%' + searchTerm + '%'} OR a.name ILIKE ${'%' + searchTerm + '%'}
                        ORDER BY b.title ASC
                        LIMIT 5
                    `;
                    suggestions = suggestionResult;
                } catch (err) {
                    console.warn('Suggestion search failed:', err.message);
                }
            }

            return Response.json({
                query: q.trim(),
                results: result,
                suggestions,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum)
                },
                filters: {
                    genre: genre || null,
                    author: author || null,
                    minPrice: minPrice ? parseFloat(minPrice) : null,
                    maxPrice: maxPrice ? parseFloat(maxPrice) : null
                }
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/search/suggestions - Get search suggestions
    async suggestions(request) {
        try {
            const url = new URL(request.url);
            const q = url.searchParams.get('q');

            if (!q || q.trim().length < 2) {
                return Response.json([]);
            }

            const searchTerm = `%${q.trim()}%`;
            
            const result = await db.sql`
                SELECT DISTINCT 
                    b.title as suggestion,
                    'book' as type,
                    b.id,
                    a.name as author_name
                FROM books b
                LEFT JOIN authors a ON b.author_id = a.id
                WHERE b.title ILIKE ${searchTerm}
                
                UNION
                
                SELECT DISTINCT 
                    a.name as suggestion,
                    'author' as type,
                    a.id,
                    null as author_name
                FROM authors a
                WHERE a.name ILIKE ${searchTerm}
                
                UNION
                
                SELECT DISTINCT 
                    b.genre as suggestion,
                    'genre' as type,
                    null as id,
                    null as author_name
                FROM books b
                WHERE b.genre ILIKE ${searchTerm} AND b.genre IS NOT NULL
                
                ORDER BY suggestion
                LIMIT 10
            `;
            
            return Response.json(result);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/search/popular - Get popular search terms
    async popular(request) {
        try {
            const [genreResult, authorResult] = await Promise.all([
                db.sql`
                    SELECT genre as term, 'genre' as type, COUNT(*) as count
                    FROM books 
                    WHERE genre IS NOT NULL 
                    GROUP BY genre 
                    ORDER BY count DESC 
                    LIMIT 5
                `,
                db.sql`
                    SELECT a.name as term, 'author' as type, COUNT(b.id) as count
                    FROM authors a
                    LEFT JOIN books b ON a.id = b.author_id
                    GROUP BY a.id, a.name
                    ORDER BY count DESC
                    LIMIT 5
                `
            ]);

            const popular = [
                ...genreResult,
                ...authorResult
            ].sort((a, b) => b.count - a.count);

            return Response.json(popular);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }
}

export default new SearchHandler();