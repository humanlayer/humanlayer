-- Create the notes table
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create the notes_operations table
CREATE TABLE notes_operations (
    id SERIAL PRIMARY KEY,
    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    op BYTEA NOT NULL
);

-- Create the ydoc_awareness table
CREATE TABLE ydoc_awareness (
    clientId TEXT,
    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    op BYTEA NOT NULL,
    updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clientId, note_id)
);

-- Create function to clean up old awareness data
CREATE OR REPLACE FUNCTION delete_old_rows()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM ydoc_awareness
    WHERE updated < NOW() - INTERVAL '2 minutes';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cleanup
CREATE TRIGGER delete_old_rows_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH STATEMENT
EXECUTE FUNCTION delete_old_rows();
