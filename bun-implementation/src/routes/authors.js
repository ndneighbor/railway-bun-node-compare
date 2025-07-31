import db from '../database/connection.js';

export class AuthorsHandler {
    // GET /api/authors - List authors
    async list(request) {
        try {
            const result = await db.sql`
                SELECT a.*, COUNT(b.id) as book_count
                FROM authors a
                LEFT JOIN books b ON a.id = b.author_id
                GROUP BY a.id
                ORDER BY a.name
            `;

            return Response.json(result);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/authors/:id - Get author with their books
    async getById(request, id) {
        try {
            // Get author details
            const authorResult = await db.sql`SELECT * FROM authors WHERE id = ${id}`;
            
            if (authorResult.length === 0) {
                return Response.json({ error: 'Author not found' }, { status: 404 });
            }

            // Get author's books
            const booksResult = await db.sql`
                SELECT * FROM books 
                WHERE author_id = ${id} 
                ORDER BY created_at DESC
            `;

            const author = authorResult[0];
            author.books = booksResult;

            return Response.json(author);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // POST /api/authors - Create author (admin)
    async create(request) {
        try {
            const body = await request.json();
            const { name, bio } = body;

            if (!name) {
                return Response.json({ error: 'Missing required field: name' }, { status: 400 });
            }

            const result = await db.sql`
                INSERT INTO authors (name, bio)
                VALUES (${name}, ${bio})
                RETURNING *
            `;

            return Response.json(result[0], { status: 201 });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // PUT /api/authors/:id - Update author (admin)
    async update(request, id) {
        try {
            const body = await request.json();
            const { name, bio } = body;

            const result = await db.sql`
                UPDATE authors 
                SET name = COALESCE(${name}, name),
                    bio = COALESCE(${bio}, bio)
                WHERE id = ${id}
                RETURNING *
            `;

            if (result.length === 0) {
                return Response.json({ error: 'Author not found' }, { status: 404 });
            }

            return Response.json(result[0]);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // DELETE /api/authors/:id - Delete author (admin)
    async delete(request, id) {
        try {
            // Check if author has books
            const booksResult = await db.sql`SELECT COUNT(*) FROM books WHERE author_id = ${id}`;
            const bookCount = parseInt(booksResult[0].count);

            if (bookCount > 0) {
                return Response.json({ 
                    error: `Cannot delete author with ${bookCount} books. Delete books first.` 
                }, { status: 400 });
            }

            const result = await db.sql`DELETE FROM authors WHERE id = ${id} RETURNING *`;

            if (result.length === 0) {
                return Response.json({ error: 'Author not found' }, { status: 404 });
            }

            return Response.json({ message: 'Author deleted successfully' });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }
}

export default new AuthorsHandler();