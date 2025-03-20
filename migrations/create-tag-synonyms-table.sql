CREATE TABLE IF NOT EXISTS tag_synonyms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_tag VARCHAR(255) NOT NULL,
  better_tag VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (original_tag)
);

-- Add some example tag synonyms
-- These are examples; adjust according to your domain-specific needs
INSERT IGNORE INTO tag_synonyms (original_tag, better_tag) VALUES 
('js', 'javascript'),
('py', 'python'),
('ai', 'artificial-intelligence'),
('ml', 'machine-learning'),
('db', 'database'),
('react', 'reactjs'),
('node', 'nodejs'),
('vue', 'vuejs');
