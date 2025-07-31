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
                return new Response(JSON.stringify({ error: 'Search query (q) is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const pageNum = parseInt(page);
            const limitNum = Math.min(parseInt(limit) || 20, 100);
            const offset = (pageNum - 1) * limitNum;

            let query = `
                SELECT b.*, a.name as author_name,
                       ts_rank(
                           to_tsvector('english', b.title || ' ' || COALESCE(b.description, '')),
                           plainto_tsquery('english', $1)
                       ) as rank
                FROM books b
                LEFT JOIN authors a ON b.author_id = a.id
                WHERE (
                    b.title ILIKE $2 OR 
                    b.description ILIKE $2 OR
                    b.genre ILIKE $2 OR
                    a.name ILIKE $2 OR
                    to_tsvector('english', b.title || ' ' || COALESCE(b.description, '')) @@ plainto_tsquery('english', $1)
                )
            `;

            const params = [q.trim(), `%${q.trim()}%`];
            let paramIndex = 3;

            // Add filters
            if (genre) {
                query += ` AND b.genre ILIKE $${paramIndex}`;
                params.push(`%${genre}%`);
                paramIndex++;
            }

            if (author) {
                query += ` AND a.name ILIKE $${paramIndex}`;
                params.push(`%${author}%`);
                paramIndex++;
            }

            if (minPrice) {
                query += ` AND b.price >= $${paramIndex}`;
                params.push(parseFloat(minPrice));
                paramIndex++;
            }

            if (maxPrice) {
                query += ` AND b.price <= $${paramIndex}`;
                params.push(parseFloat(maxPrice));
                paramIndex++;
            }

            // Get total count for pagination
            const countQuery = query
                .replace(/SELECT b\.\*, a\.name as author_name,[\s\S]*?FROM/, 'SELECT COUNT(*) FROM')
                .replace(/ORDER BY[\s\S]*$/, '');
            
            const countResult = await db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            // Add ordering and pagination
            query += ` ORDER BY rank DESC, b.title ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limitNum, offset);

            const result = await db.query(query, params);

            // Get search suggestions for similar terms
            let suggestions = [];
            if (result.rows.length === 0) {
                const suggestionQuery = `
                    SELECT DISTINCT b.title, a.name as author_name, b.genre
                    FROM books b
                    LEFT JOIN authors a ON b.author_id = a.id
                    WHERE similarity(b.title, $1) > 0.3 OR similarity(a.name, $1) > 0.3
                    ORDER BY greatest(similarity(b.title, $1), similarity(a.name, $1)) DESC
                    LIMIT 5
                `;
                
                try {
                    const suggestionResult = await db.query(suggestionQuery, [q.trim()]);
                    suggestions = suggestionResult.rows;
                } catch (err) {
                    // Similarity extension might not be available, continue without suggestions
                    console.warn('Similarity search not available:', err.message);
                }
            }

            return new Response(JSON.stringify({
                query: q.trim(),
                results: result.rows,
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
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // GET /api/search/suggestions - Get search suggestions
    async suggestions(request) {
        try {
            const url = new URL(request.url);
            const q = url.searchParams.get('q');

            if (!q || q.trim().length < 2) {
                return new Response(JSON.stringify([]), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const query = `
                SELECT DISTINCT 
                    b.title as suggestion,
                    'book' as type,
                    b.id,
                    a.name as author_name
                FROM books b
                LEFT JOIN authors a ON b.author_id = a.id
                WHERE b.title ILIKE $1
                
                UNION
                
                SELECT DISTINCT 
                    a.name as suggestion,
                    'author' as type,
                    a.id,
                    null as author_name
                FROM authors a
                WHERE a.name ILIKE $1
                
                UNION
                
                SELECT DISTINCT 
                    b.genre as suggestion,
                    'genre' as type,
                    null as id,
                    null as author_name
                FROM books b
                WHERE b.genre ILIKE $1 AND b.genre IS NOT NULL
                
                ORDER BY suggestion
                LIMIT 10
            `;

            const result = await db.query(query, [`%${q.trim()}%`]);
            
            return new Response(JSON.stringify(result.rows), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // GET /api/search/popular - Get popular search terms
    async popular(request) {
        try {
            // Get most popular genres
            const genreQuery = `
                SELECT genre as term, 'genre' as type, COUNT(*) as count
                FROM books 
                WHERE genre IS NOT NULL 
                GROUP BY genre 
                ORDER BY count DESC 
                LIMIT 5
            `;

            // Get most popular authors
            const authorQuery = `
                SELECT a.name as term, 'author' as type, COUNT(b.id) as count
                FROM authors a
                LEFT JOIN books b ON a.id = b.author_id
                GROUP BY a.id, a.name
                ORDER BY count DESC
                LIMIT 5
            `;

            const [genreResult, authorResult] = await Promise.all([
                db.query(genreQuery),
                db.query(authorQuery)
            ]);

            const popular = [
                ...genreResult.rows,
                ...authorResult.rows
            ].sort((a, b) => b.count - a.count);

            return new Response(JSON.stringify(popular), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}

export default new SearchHandler();