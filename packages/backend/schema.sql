DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS gpa_rules;

CREATE TABLE courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  regular_score REAL,
  exam_scores TEXT,
  final_score REAL,
  gpa REAL,
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gpa_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  gpa_value REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default GPA rules
INSERT INTO gpa_rules (min_score, max_score, gpa_value) VALUES
(95, 100, 4.0),
(90, 94.9, 3.7),
(85, 89.9, 3.3),
(80, 84.9, 3.0),
(75, 79.9, 2.7),
(70, 74.9, 2.3),
(65, 69.9, 2.0),
(60, 64.9, 1.7),
(0, 59.9, 0);
