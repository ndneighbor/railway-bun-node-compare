-- Sample data for bookstore comparison platform
-- This data is used by both Node.js and Bun implementations

-- Insert sample authors
INSERT INTO authors (name, bio) VALUES 
('George Orwell', 'English novelist and essayist, journalist and critic.'),
('Jane Austen', 'English novelist known primarily for her six major novels.'),
('J.K. Rowling', 'British author, best known for the Harry Potter series.'),
('Stephen King', 'American author of horror, supernatural fiction, suspense, crime, science-fiction, and fantasy novels.'),
('Agatha Christie', 'English writer known for her detective novels.'),
('Ernest Hemingway', 'American journalist, novelist, short-story writer, and sportsman.'),
('Virginia Woolf', 'English writer, considered one of the most important modernist 20th-century authors.'),
('Mark Twain', 'American writer, humorist, entrepreneur, publisher, and lecturer.'),
('Maya Angelou', 'American memoirist, popular poet, and civil rights activist.'),
('F. Scott Fitzgerald', 'American novelist, essayist, and short story writer.')
ON CONFLICT DO NOTHING;

-- Insert sample books
INSERT INTO books (title, author_id, price, stock, description, genre, isbn, cover_url) VALUES 
('1984', 1, 15.99, 50, 'A dystopian social science fiction novel and cautionary tale.', 'Science Fiction', '9780451524935', 'https://example.com/1984.jpg'),
('Animal Farm', 1, 12.99, 30, 'An allegorical novella about farm animals who rebel against their human farmer.', 'Political Fiction', '9780451526342', 'https://example.com/animal-farm.jpg'),
('Pride and Prejudice', 2, 13.99, 25, 'A romantic novel of manners written by Jane Austen.', 'Romance', '9780141439518', 'https://example.com/pride-prejudice.jpg'),
('Sense and Sensibility', 2, 14.99, 20, 'A novel by Jane Austen, published in 1811.', 'Romance', '9780141439662', 'https://example.com/sense-sensibility.jpg'),
('Harry Potter and the Philosopher''s Stone', 3, 18.99, 100, 'The first novel in the Harry Potter series.', 'Fantasy', '9780747532699', 'https://example.com/hp1.jpg'),
('Harry Potter and the Chamber of Secrets', 3, 18.99, 95, 'The second novel in the Harry Potter series.', 'Fantasy', '9780747538493', 'https://example.com/hp2.jpg'),
('The Shining', 4, 16.99, 40, 'A horror novel by American author Stephen King.', 'Horror', '9780307743657', 'https://example.com/shining.jpg'),
('It', 4, 19.99, 35, 'A 1986 horror novel by American author Stephen King.', 'Horror', '9781501142970', 'https://example.com/it.jpg'),
('Murder on the Orient Express', 5, 14.99, 45, 'A detective novel by British writer Agatha Christie.', 'Mystery', '9780062693662', 'https://example.com/orient-express.jpg'),
('The Murder of Roger Ackroyd', 5, 13.99, 30, 'A detective novel by Agatha Christie.', 'Mystery', '9780062073556', 'https://example.com/roger-ackroyd.jpg'),
('The Old Man and the Sea', 6, 11.99, 60, 'A short novel written by American author Ernest Hemingway.', 'Literary Fiction', '9780684801223', 'https://example.com/old-man-sea.jpg'),
('A Farewell to Arms', 6, 15.99, 25, 'A novel by American writer Ernest Hemingway.', 'Literary Fiction', '9780684837888', 'https://example.com/farewell-arms.jpg'),
('Mrs. Dalloway', 7, 14.99, 20, 'A novel by Virginia Woolf published in 1925.', 'Modernist Fiction', '9780156628709', 'https://example.com/mrs-dalloway.jpg'),
('To the Lighthouse', 7, 16.99, 15, 'A 1927 novel by Virginia Woolf.', 'Modernist Fiction', '9780156907392', 'https://example.com/lighthouse.jpg'),
('The Adventures of Tom Sawyer', 8, 12.99, 40, 'An 1876 novel by Mark Twain about a young boy growing up along the Mississippi River.', 'Adventure', '9780486400778', 'https://example.com/tom-sawyer.jpg'),
('Adventures of Huckleberry Finn', 8, 13.99, 35, 'A novel by Mark Twain, first published in the United Kingdom in December 1884.', 'Adventure', '9780486280615', 'https://example.com/huck-finn.jpg'),
('I Know Why the Caged Bird Sings', 9, 15.99, 30, 'A 1969 autobiography describing the early years of American writer and poet Maya Angelou.', 'Biography', '9780345514400', 'https://example.com/caged-bird.jpg'),
('The Great Gatsby', 10, 14.99, 55, 'A 1925 novel written by American author F. Scott Fitzgerald.', 'Literary Fiction', '9780743273565', 'https://example.com/gatsby.jpg'),
('Tender Is the Night', 10, 16.99, 20, 'A novel by American writer F. Scott Fitzgerald.', 'Literary Fiction', '9780684801544', 'https://example.com/tender-night.jpg'),
('This Side of Paradise', 10, 13.99, 25, 'The debut novel by F. Scott Fitzgerald, published in 1920.', 'Literary Fiction', '9780486411507', 'https://example.com/paradise.jpg')
ON CONFLICT (isbn) DO NOTHING;

-- Insert sample orders
INSERT INTO orders (total, status, customer_email) VALUES 
(45.97, 'completed', 'john.doe@example.com'),
(28.98, 'completed', 'jane.smith@example.com'),
(18.99, 'pending', 'bob.wilson@example.com'),
(62.96, 'completed', 'alice.johnson@example.com'),
(31.98, 'processing', 'charlie.brown@example.com')
ON CONFLICT DO NOTHING;

-- Insert sample order items
INSERT INTO order_items (order_id, book_id, quantity, price) VALUES 
(1, 1, 2, 15.99),
(1, 3, 1, 13.99),
(2, 5, 1, 18.99),
(2, 11, 1, 11.99),
(3, 5, 1, 18.99),
(4, 7, 2, 16.99),
(4, 9, 2, 14.99),
(5, 18, 2, 14.99)
ON CONFLICT DO NOTHING;