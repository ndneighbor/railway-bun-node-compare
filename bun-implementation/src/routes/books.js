import db from '../database/connection.js';

export class BooksHandler {
    // GET /api/books - List books with pagination and filtering
    async list(request) {
        try {
            const url = new URL(request.url);
            const page = parseInt(url.searchParams.get('page')) || 1;
            const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
            const offset = (page - 1) * limit;
            const genre = url.searchParams.get('genre');
            const author = url.searchParams.get('author');
            const minPrice = url.searchParams.get('minPrice');
            const maxPrice = url.searchParams.get('maxPrice');
            const search = url.searchParams.get('search');

            // Build dynamic query conditions safely
            let conditions = [];
            
            if (genre) conditions.push(db.sql`b.genre ILIKE ${'%' + genre + '%'}`);
            if (author) conditions.push(db.sql`a.name ILIKE ${'%' + author + '%'}`);
            if (minPrice) conditions.push(db.sql`b.price >= ${parseFloat(minPrice)}`);
            if (maxPrice) conditions.push(db.sql`b.price <= ${parseFloat(maxPrice)}`);
            if (search) conditions.push(db.sql`(b.title ILIKE ${'%' + search + '%'} OR b.description ILIKE ${'%' + search + '%'})`);

            const whereClause = conditions.length > 0 
                ? db.sql` WHERE ${db.sql.join(conditions, db.sql` AND `)}`
                : db.sql``;

            // Get total count
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
                ORDER BY b.created_at DESC 
                LIMIT ${limit} OFFSET ${offset}
            `;

            return Response.json({
                books: result,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/books/:id - Get book details
    async getById(request, id) {
        try {
            const result = await db.sql`
                SELECT b.*, a.name as author_name, a.bio as author_bio
                FROM books b 
                LEFT JOIN authors a ON b.author_id = a.id 
                WHERE b.id = ${id}
            `;

            if (result.length === 0) {
                return Response.json({ error: 'Book not found' }, { status: 404 });
            }

            return Response.json(result[0]);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // POST /api/books - Create new book (admin)
    async create(request) {
        try {
            const body = await request.json();
            const { title, author_id, price, stock, description, genre, isbn, cover_url } = body;

            if (!title || !author_id || !price) {
                return Response.json({ 
                    error: 'Missing required fields: title, author_id, price' 
                }, { status: 400 });
            }

            const result = await db.sql`
                INSERT INTO books (title, author_id, price, stock, description, genre, isbn, cover_url)
                VALUES (${title}, ${author_id}, ${price}, ${stock || 0}, ${description}, ${genre}, ${isbn}, ${cover_url})
                RETURNING *
            `;

            return Response.json(result[0], { status: 201 });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // PUT /api/books/:id - Update book (admin)
    async update(request, id) {
        try {
            const body = await request.json();
            const { title, author_id, price, stock, description, genre, isbn, cover_url } = body;

            const result = await db.sql`
                UPDATE books 
                SET title = COALESCE(${title}, title),
                    author_id = COALESCE(${author_id}, author_id),
                    price = COALESCE(${price}, price),
                    stock = COALESCE(${stock}, stock),
                    description = COALESCE(${description}, description),
                    genre = COALESCE(${genre}, genre),
                    isbn = COALESCE(${isbn}, isbn),
                    cover_url = COALESCE(${cover_url}, cover_url)
                WHERE id = ${id}
                RETURNING *
            `;

            if (result.length === 0) {
                return Response.json({ error: 'Book not found' }, { status: 404 });
            }

            return Response.json(result[0]);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // DELETE /api/books/:id - Delete book (admin)
    async delete(request, id) {
        try {
            const result = await db.sql`DELETE FROM books WHERE id = ${id} RETURNING *`;

            if (result.length === 0) {
                return Response.json({ error: 'Book not found' }, { status: 404 });
            }

            return Response.json({ message: 'Book deleted successfully' });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }
}

export default new BooksHandler();