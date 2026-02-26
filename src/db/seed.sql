-- Seed a default candidate for local testing. Use this candidate's id in POST /interview/start.
INSERT INTO candidates (id, email, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'candidate@example.com', 'Test Candidate')
ON CONFLICT (id) DO NOTHING;

-- Optional: seed competencies
INSERT INTO competencies (id, name, description) VALUES
  ('communication', 'Communication', 'Clarity and effectiveness of expression'),
  ('problem_solving', 'Problem Solving', 'Analytical and solution-oriented thinking'),
  ('technical_depth', 'Technical Depth', 'Depth of technical knowledge and practice'),
  ('judgment', 'Judgment', 'Quality of decisions and trade-offs'),
  ('collaboration', 'Collaboration', 'Working with others and stakeholders'),
  ('engagement', 'Engagement', 'Interest and questions about the role')
ON CONFLICT (id) DO NOTHING;
