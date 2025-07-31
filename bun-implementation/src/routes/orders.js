import db from '../database/connection.js';

export class OrdersHandler {
    // POST /api/orders - Create new order
    async create(request) {
        try {
            const body = await request.json();
            const { items, customer_email } = body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return new Response(JSON.stringify({ 
                    error: 'Missing required field: items (non-empty array)' 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (!customer_email) {
                return new Response(JSON.stringify({ 
                    error: 'Missing required field: customer_email' 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Use transaction for order creation
            const result = await db.transaction(async (sql) => {
                // Calculate total and validate items
                let total = 0;
                const validatedItems = [];

                for (const item of items) {
                    const { book_id, quantity } = item;

                    if (!book_id || !quantity || quantity <= 0) {
                        throw new Error('Each item must have book_id and positive quantity');
                    }

                    // Get book details and check stock
                    const bookResult = await sql`
                        SELECT id, title, price, stock FROM books WHERE id = ${book_id}
                    `;

                    if (bookResult.length === 0) {
                        throw new Error(`Book with id ${book_id} not found`);
                    }

                    const book = bookResult[0];

                    if (book.stock < quantity) {
                        throw new Error(`Insufficient stock for book "${book.title}". Available: ${book.stock}, requested: ${quantity}`);
                    }

                    const itemTotal = parseFloat(book.price) * quantity;
                    total += itemTotal;

                    validatedItems.push({
                        book_id,
                        quantity,
                        price: book.price,
                        title: book.title
                    });

                    // Update stock
                    await sql`
                        UPDATE books SET stock = stock - ${quantity} WHERE id = ${book_id}
                    `;
                }

                // Create order
                const orderResult = await sql`
                    INSERT INTO orders (total, customer_email) 
                    VALUES (${total}, ${customer_email}) 
                    RETURNING *
                `;

                const order = orderResult[0];

                // Create order items
                for (const item of validatedItems) {
                    await sql`
                        INSERT INTO order_items (order_id, book_id, quantity, price) 
                        VALUES (${order.id}, ${item.book_id}, ${item.quantity}, ${item.price})
                    `;
                }

                return { ...order, items: validatedItems };
            });

            return new Response(JSON.stringify(result), {
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

    // GET /api/orders/:id - Get order details
    async getById(request, id) {
        try {
            // Get order details
            const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [id]);

            if (orderResult.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Order not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Get order items with book details
            const itemsResult = await db.query(`
                SELECT oi.*, b.title, b.isbn, b.cover_url
                FROM order_items oi
                JOIN books b ON oi.book_id = b.id
                WHERE oi.order_id = $1
            `, [id]);

            const order = orderResult.rows[0];
            order.items = itemsResult.rows;

            return new Response(JSON.stringify(order), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // PUT /api/orders/:id/status - Update order status (admin)
    async updateStatus(request, id) {
        try {
            const body = await request.json();
            const { status } = body;

            const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
            
            if (!status || !validStatuses.includes(status)) {
                return new Response(JSON.stringify({ 
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
                }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const result = await db.query(
                'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
                [status, id]
            );

            if (result.rows.length === 0) {
                return new Response(JSON.stringify({ error: 'Order not found' }), {
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

    // GET /api/orders - List orders (admin)
    async list(request) {
        try {
            const url = new URL(request.url);
            const page = parseInt(url.searchParams.get('page')) || 1;
            const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
            const offset = (page - 1) * limit;
            const status = url.searchParams.get('status');

            let query = 'SELECT * FROM orders';
            const params = [];

            if (status) {
                query += ' WHERE status = $1';
                params.push(status);
            }

            // Get total count
            const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
            const countResult = await db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            // Add pagination
            query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            return new Response(JSON.stringify({
                orders: result.rows,
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
}

export default new OrdersHandler();