import React, { useState } from 'react';

export function BookDetail({ book, onAddToCart }) {
    const [quantity, setQuantity] = useState(1);
    const [loading, setLoading] = useState(false);

    const handleAddToCart = async () => {
        setLoading(true);
        try {
            await onAddToCart(book.id, quantity);
        } catch (error) {
            console.error('Error adding to cart:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!book) {
        return (
            <div className="book-detail">
                <div className="loading">Loading book details...</div>
            </div>
        );
    }

    return (
        <div className="book-detail">
            <div className="book-detail-content">
                <div className="book-cover-section">
                    {book.cover_url ? (
                        <img src={book.cover_url} alt={book.title} className="book-cover-large" />
                    ) : (
                        <div className="book-cover-placeholder">
                            <span>No Cover Available</span>
                        </div>
                    )}
                </div>
                
                <div className="book-info-section">
                    <h1 className="book-title">{book.title}</h1>
                    
                    <div className="book-meta">
                        <p className="book-author">
                            <strong>Author:</strong> 
                            <a href={`/authors/${book.author_id}`}>
                                {book.author_name}
                            </a>
                        </p>
                        
                        {book.genre && (
                            <p className="book-genre">
                                <strong>Genre:</strong> {book.genre}
                            </p>
                        )}
                        
                        {book.isbn && (
                            <p className="book-isbn">
                                <strong>ISBN:</strong> {book.isbn}
                            </p>
                        )}
                        
                        <p className="book-price">
                            <strong>Price:</strong> ${parseFloat(book.price).toFixed(2)}
                        </p>
                        
                        <p className={`book-stock ${book.stock <= 0 ? 'out-of-stock' : book.stock < 10 ? 'low-stock' : ''}`}>
                            <strong>Stock:</strong> {book.stock > 0 ? `${book.stock} available` : 'Out of stock'}
                        </p>
                    </div>
                    
                    {book.description && (
                        <div className="book-description">
                            <h3>Description</h3>
                            <p>{book.description}</p>
                        </div>
                    )}
                    
                    {book.author_bio && (
                        <div className="author-bio">
                            <h3>About the Author</h3>
                            <p>{book.author_bio}</p>
                        </div>
                    )}
                    
                    {book.stock > 0 && (
                        <div className="purchase-section">
                            <div className="quantity-selector">
                                <label htmlFor="quantity">Quantity:</label>
                                <select
                                    id="quantity"
                                    value={quantity}
                                    onChange={(e) => setQuantity(parseInt(e.target.value))}
                                    className="quantity-input"
                                >
                                    {Array.from({ length: Math.min(book.stock, 10) }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>
                                            {i + 1}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            <button
                                onClick={handleAddToCart}
                                disabled={loading || book.stock <= 0}
                                className="btn btn-primary btn-large"
                            >
                                {loading ? 'Adding...' : 'Add to Cart'}
                            </button>
                            
                            <div className="total-price">
                                <strong>Total: ${(parseFloat(book.price) * quantity).toFixed(2)}</strong>
                            </div>
                        </div>
                    )}
                    
                    {book.stock <= 0 && (
                        <div className="out-of-stock-notice">
                            <p>This item is currently out of stock.</p>
                            <button className="btn btn-outline">
                                Notify When Available
                            </button>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="book-actions">
                <a href="/books" className="btn btn-outline">
                    ← Back to Books
                </a>
                <button className="btn btn-outline" onClick={() => window.print()}>
                    Print Details
                </button>
                <button className="btn btn-outline" onClick={() => {
                    if (navigator.share) {
                        navigator.share({
                            title: book.title,
                            text: `Check out "${book.title}" by ${book.author_name}`,
                            url: window.location.href
                        });
                    } else {
                        // Fallback for browsers without Web Share API
                        navigator.clipboard.writeText(window.location.href);
                        alert('Link copied to clipboard!');
                    }
                }}>
                    Share
                </button>
            </div>
        </div>
    );
}