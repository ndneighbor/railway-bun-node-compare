import db from '../database/connection.js';

export class OrdersHandler {
    // POST /api/orders - Create new order
    async create(request) {
        try {
            const body = await request.json();
            const { items, customer_email } = body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return Response.json({ 
                    error: 'Missing required field: items (non-empty array)' 
                }, { status: 400 });
            }

            if (!customer_email) {
                return Response.json({ 
                    error: 'Missing required field: customer_email' 
                }, { status: 400 });
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

            return Response.json(result, { status: 201 });
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // GET /api/orders/:id - Get order details
    async getById(request, id) {
        try {
            // Get order details
            const orderResult = await db.sql`SELECT * FROM orders WHERE id = ${id}`;

            if (orderResult.length === 0) {
                return Response.json({ error: 'Order not found' }, { status: 404 });
            }

            // Get order items with book details
            const itemsResult = await db.sql`
                SELECT oi.*, b.title, b.isbn, b.cover_url
                FROM order_items oi
                JOIN books b ON oi.book_id = b.id
                WHERE oi.order_id = ${id}
            `;

            const order = orderResult[0];
            order.items = itemsResult;

            return Response.json(order);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
        }
    }

    // PUT /api/orders/:id/status - Update order status (admin)
    async updateStatus(request, id) {
        try {
            const body = await request.json();
            const { status } = body;

            const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
            
            if (!status || !validStatuses.includes(status)) {
                return Response.json({ 
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
                }, { status: 400 });
            }

            const result = await db.sql`
                UPDATE orders SET status = ${status} WHERE id = ${id} RETURNING *
            `;

            if (result.length === 0) {
                return Response.json({ error: 'Order not found' }, { status: 404 });
            }

            return Response.json(result[0]);
        } catch (error) {
            return Response.json({ error: error.message }, { status: 500 });
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

            // Build dynamic query conditions safely
            const whereClause = status 
                ? db.sql`WHERE status = ${status}`
                : db.sql``;

            // Get total count
            const countResult = await db.sql`
                SELECT COUNT(*) as count
                FROM orders 
                ${whereClause}
            `;
            const total = parseInt(countResult[0].count);

            // Get paginated results
            const result = await db.sql`
                SELECT * FROM orders 
                ${whereClause}
                ORDER BY created_at DESC 
                LIMIT ${limit} OFFSET ${offset}
            `;

            return Response.json({
                orders: result,
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
}

export default new OrdersHandler();