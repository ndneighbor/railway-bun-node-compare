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

            let query = `
                SELECT b.*, a.name as author_name 
                FROM books b 
                LEFT JOIN authors a ON b.author_id = a.id 
                WHERE 1=1
            `;
            const params = [];
            let paramIndex = 1;

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

            if (search) {
                query += ` AND (b.title ILIKE $${paramIndex} OR b.description ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            // Get total count for pagination
            const countQuery = query.replace('SELECT b.*, a.name as author_name', 'SELECT COUNT(*)');
            const countResult = await db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            // Add pagination
            query += ` ORDER BY b.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            return new Response(JSON.stringify({
                books: result.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
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

    // GET /api/books/:id - Get book details
    async getById(request, id) {
        try {
            const result = await db.query(`
                SELECT b.*, a.name as author_name, a.bio as author_bio
                FROM books b 
                LEFT JOIN authors a ON b.author_id = a.id 
                WHERE b.id = $1
            `, [id]);

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Book not found' }), {
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

    // POST /api/books - Create new book (admin)
    async create(request) {
        try {
            const body = await request.json();
            const { title, author_id, price, stock, description, genre, isbn, cover_url } = body;

            if (!title || !author_id || !price) {
                return new Response(JSON.stringify({ 
                    error: 'Missing required fields: title, author_id, price' 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const result = await db.query(`
                INSERT INTO books (title, author_id, price, stock, description, genre, isbn, cover_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [title, author_id, price, stock || 0, description, genre, isbn, cover_url]);

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

    // PUT /api/books/:id - Update book (admin)
    async update(request, id) {
        try {
            const body = await request.json();
            const { title, author_id, price, stock, description, genre, isbn, cover_url } = body;

            const result = await db.query(`
                UPDATE books 
                SET title = COALESCE($1, title),
                    author_id = COALESCE($2, author_id),
                    price = COALESCE($3, price),
                    stock = COALESCE($4, stock),
                    description = COALESCE($5, description),
                    genre = COALESCE($6, genre),
                    isbn = COALESCE($7, isbn),
                    cover_url = COALESCE($8, cover_url)
                WHERE id = $9
                RETURNING *
            `, [title, author_id, price, stock, description, genre, isbn, cover_url, id]);

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Book not found' }), {
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

    // DELETE /api/books/:id - Delete book (admin)
    async delete(request, id) {
        try {
            const result = await db.query('DELETE FROM books WHERE id = $1 RETURNING *', [id]);

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Book not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            return new Response(JSON.stringify({ message: 'Book deleted successfully' }), {
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

export default new BooksHandler();