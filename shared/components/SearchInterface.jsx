import React, { useState, useEffect, useRef } from 'react';

export function SearchInterface({ onSearch, initialQuery = '' }) {
    const [query, setQuery] = useState(initialQuery);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
    const [popular, setPopular] = useState([]);
    const searchRef = useRef(null);
    const suggestionsRef = useRef(null);

    useEffect(() => {
        fetchPopularTerms();
    }, []);

    useEffect(() => {
        if (query.length >= 2) {
            fetchSuggestions(query);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
        }
    }, [query]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (suggestionsRef.current && !suggestionsRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchSuggestions = async (searchQuery) => {
        if (!searchQuery || searchQuery.length < 2) return;
        
        try {
            const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`);
            const data = await response.json();
            setSuggestions(data);
            setShowSuggestions(true);
        } catch (error) {
            console.error('Error fetching suggestions:', error);
        }
    };

    const fetchPopularTerms = async () => {
        try {
            const response = await fetch('/api/search/popular');
            const data = await response.json();
            setPopular(data);
        } catch (error) {
            console.error('Error fetching popular terms:', error);
        }
    };

    const handleSearch = async (searchQuery = query) => {
        if (!searchQuery.trim()) return;
        
        setLoading(true);
        setShowSuggestions(false);
        
        try {
            await onSearch(searchQuery.trim());
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSuggestionClick = (suggestion) => {
        setQuery(suggestion.suggestion);
        setShowSuggestions(false);
        handleSearch(suggestion.suggestion);
    };

    const handlePopularClick = (term) => {
        setQuery(term.term);
        handleSearch(term.term);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    const highlightMatch = (text, query) => {
        if (!query) return text;
        
        const regex = new RegExp(`(${query})`, 'gi');
        const parts = text.split(regex);
        
        return parts.map((part, index) =>
            regex.test(part) ? (
                <mark key={index}>{part}</mark>
            ) : (
                part
            )
        );
    };

    return (
        <div className="search-interface">
            <div className="search-container" ref={searchRef}>
                <div className="search-input-wrapper">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => query.length >= 2 && setShowSuggestions(true)}
                        placeholder="Search for books, authors, or genres..."
                        className="search-input"
                        disabled={loading}
                    />
                    <button
                        onClick={() => handleSearch()}
                        disabled={loading || !query.trim()}
                        className="search-button"
                    >
                        {loading ? (
                            <span className="loading-spinner">⏳</span>
                        ) : (
                            <span className="search-icon">🔍</span>
                        )}
                    </button>
                </div>

                {showSuggestions && suggestions.length > 0 && (
                    <div className="suggestions-dropdown" ref={suggestionsRef}>
                        <div className="suggestions-list">
                            {suggestions.map((suggestion, index) => (
                                <div
                                    key={`${suggestion.type}-${suggestion.id || index}`}
                                    className={`suggestion-item ${suggestion.type}`}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                >
                                    <div className="suggestion-content">
                                        <span className="suggestion-text">
                                            {highlightMatch(suggestion.suggestion, query)}
                                        </span>
                                        <span className="suggestion-type">
                                            {suggestion.type}
                                        </span>
                                    </div>
                                    {suggestion.author_name && (
                                        <div className="suggestion-meta">
                                            by {suggestion.author_name}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {!query && popular.length > 0 && (
                <div className="popular-searches">
                    <h3>Popular Searches</h3>
                    <div className="popular-tags">
                        {popular.map((term, index) => (
                            <button
                                key={index}
                                onClick={() => handlePopularClick(term)}
                                className={`popular-tag ${term.type}`}
                            >
                                {term.term}
                                <span className="popular-count">({term.count})</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="search-tips">
                <details>
                    <summary>Search Tips</summary>
                    <ul>
                        <li>Search for book titles, author names, or genres</li>
                        <li>Use quotes for exact phrases: "science fiction"</li>
                        <li>Combine terms: mystery agatha christie</li>
                        <li>Browse by clicking popular searches above</li>
                    </ul>
                </details>
            </div>
        </div>
    );
}