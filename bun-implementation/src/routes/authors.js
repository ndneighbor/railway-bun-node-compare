import db from '../database/connection.js';

export class AuthorsHandler {
    // GET /api/authors - List authors
    async list(request) {
        try {
            const result = await db.query(`
                SELECT a.*, COUNT(b.id) as book_count
                FROM authors a
                LEFT JOIN books b ON a.id = b.author_id
                GROUP BY a.id
                ORDER BY a.name
            `);

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

    // GET /api/authors/:id - Get author with their books
    async getById(request, id) {
        try {
            // Get author details
            const authorResult = await db.query('SELECT * FROM authors WHERE id = $1', [id]);
            
            if (authorResult.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Author not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get author's books
            const booksResult = await db.query(`
                SELECT * FROM books 
                WHERE author_id = $1 
                ORDER BY created_at DESC
            `, [id]);

            const author = authorResult.rows[0];
            author.books = booksResult.rows;

            return new Response(JSON.stringify(author), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // POST /api/authors - Create author (admin)
    async create(request) {
        try {
            const body = await request.json();
            const { name, bio } = body;

            if (!name) {
                return new Response(JSON.stringify({ error: 'Missing required field: name' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const result = await db.query(`
                INSERT INTO authors (name, bio)
                VALUES ($1, $2)
                RETURNING *
            `, [name, bio]);

            return new Response(JSON.stringify(result.rows[0]), {
                status: 201,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // PUT /api/authors/:id - Update author (admin)
    async update(request, id) {
        try {
            const body = await request.json();
            const { name, bio } = body;

            const result = await db.query(`
                UPDATE authors 
                SET name = COALESCE($1, name),
                    bio = COALESCE($2, bio)
                WHERE id = $3
                RETURNING *
            `, [name, bio, id]);

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Author not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify(result.rows[0]), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // DELETE /api/authors/:id - Delete author (admin)
    async delete(request, id) {
        try {
            // Check if author has books
            const booksResult = await db.query('SELECT COUNT(*) FROM books WHERE author_id = $1', [id]);
            const bookCount = parseInt(booksResult.rows[0].count);

            if (bookCount > 0) {
                return new Response(JSON.stringify({ 
                    error: `Cannot delete author with ${bookCount} books. Delete books first.` 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const result = await db.query('DELETE FROM authors WHERE id = $1 RETURNING *', [id]);

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Author not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ message: 'Author deleted successfully' }), {
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

export default new AuthorsHandler();