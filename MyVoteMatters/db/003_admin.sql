-- Owner administration: removing members from an organisation.
-- Users are shared across organisations, so removal deletes the membership,
-- not the user; the app clears the password once no membership remains.
SET ROLE vs_owner;
SET search_path = vs, public;

GRANT DELETE ON memberships TO vs_app;
