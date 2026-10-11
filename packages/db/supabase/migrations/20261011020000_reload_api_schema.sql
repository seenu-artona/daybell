-- Ask the Data API to reload its list of tables and functions, so new functions are callable right after a deploy.
-- Every migration that adds or changes functions ends with this line (see packages/db/README.md).
notify pgrst, 'reload schema';
