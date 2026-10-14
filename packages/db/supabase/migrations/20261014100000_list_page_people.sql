-- D150 People (ADR 0028): the People lists can save "+ Add filter" chips like Jobs and Orders (D147). Its own
-- migration: a new enum value can't be used in the transaction that adds it, and 20261014100100_people.sql uses them
-- in save_list_filters.
alter type public.list_page add value if not exists 'people_clients';
alter type public.list_page add value if not exists 'people_contacts';
alter type public.list_page add value if not exists 'people_subjects';
