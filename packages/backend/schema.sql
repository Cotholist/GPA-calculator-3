DROP TABLE IF EXISTS courses;

CREATE TABLE courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  regular_score REAL,
  exam_scores TEXT,
  final_score REAL,
  gpa REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
