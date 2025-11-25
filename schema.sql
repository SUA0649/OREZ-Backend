/*
-- ALL of this is specific for POSTGRES DB
-- To run the schema in docker and ensure all the tables are successfully created:
   docker cp schema.sql postgresdb:/tmp/schema.sql
   docker exec -it postgresdb psql -U orez -d appdb -f /tmp/schema.sql
*/

-- ==========================================
-- 1. CORE TABLES
-- ==========================================

CREATE TABLE IF NOT EXISTS users(
    user_id serial primary key,
    user_name varchar(30) not null unique,
    password_hash varchar(255) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP,
    updated_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS REPOSITORY(
    repo_id serial primary key,
    name varchar(50) not null,
    description varchar(100) not null,
    owner_id int references users(user_id) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP,
    updated_at TIMESTAMP default CURRENT_TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS RepoPermission(
    user_id int references users(user_id) not null,
    repo_id int references REPOSITORY(repo_id) not null,
    permission varchar(20) not null check (permission in ('Owner','Viewer','Contributor')),
    created_at TIMESTAMP default CURRENT_TIMESTAMP,
    updated_at TIMESTAMP default CURRENT_TIMESTAMP,
    UNIQUE(user_id, repo_id)
);

CREATE TABLE IF NOT EXISTS Blob (
    blob_id serial primary key,
    hash varchar(100) not null unique,
    content_path varchar(200) not null unique,
    size int not null, 
    created_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Tree(
    tree_id serial primary key,
    hash varchar(100) not null unique,
    repo_id int references REPOSITORY(repo_id) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS Tree_Entry(
    entry_id serial primary key,
    tree_id int references Tree(tree_id) not null, 
    name VARCHAR(255) NOT NULL, 
    mode VARCHAR(10) NOT NULL,  
    blob_id int references Blob(blob_id), 
    child_tree_id int references Tree(tree_id), 
    UNIQUE(tree_id, name) 
);

CREATE TABLE IF NOT EXISTS Commit(
    commit_id serial primary key,
    hash varchar(100) not null,
    repo_id int references REPOSITORY(repo_id) not null,
    tree_id int references Tree(tree_id) not null,
    owner_id int references users(user_id) not null,
    message varchar(100) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Commit_Parent(
    parent_id serial primary key,
    commit_id int references Commit(commit_id) not null,
    parent_commit int references Commit(commit_id)
);

-- New Table: Audit Log for tracking security changes
CREATE TABLE IF NOT EXISTS audit_log (
    log_id SERIAL PRIMARY KEY,
    table_name VARCHAR(50),
    action_type VARCHAR(10),
    repo_id INT,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. AUTOMATION TRIGGERS (Timestamps)
-- ==========================================

-- Generic function to auto-update 'updated_at' columns
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to Users
DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Attach to Repository
DROP TRIGGER IF EXISTS update_repo_modtime ON repository;
CREATE TRIGGER update_repo_modtime
BEFORE UPDATE ON repository
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE OR REPLACE FUNCTION update_permission_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_permission_timestamp ON RepoPermission;
CREATE TRIGGER tr_update_permission_timestamp
BEFORE UPDATE ON RepoPermission
FOR EACH ROW EXECUTE FUNCTION update_permission_timestamp();

-- ==========================================
-- 3. AUDIT LOG TRIGGERS
-- ==========================================

CREATE OR REPLACE FUNCTION log_permission_change()
RETURNS TRIGGER AS $$
DECLARE
    target_repo_id INT;
BEGIN
    -- Determine repo_id based on operation
    IF (TG_OP = 'DELETE') THEN
        target_repo_id := OLD.repo_id;
    ELSE
        target_repo_id := NEW.repo_id;
    END IF;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_log (table_name, action_type, repo_id, details)
        VALUES ('RepoPermission', 'INSERT', target_repo_id, 'User ' || NEW.user_id || ' added as ' || NEW.permission);
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_log (table_name, action_type, repo_id, details)
        VALUES ('RepoPermission', 'UPDATE', target_repo_id, 'User ' || NEW.user_id || ' role changed to ' || NEW.permission);
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_log (table_name, action_type, repo_id, details)
        VALUES ('RepoPermission', 'DELETE', target_repo_id, 'User ' || OLD.user_id || ' removed');
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_repo_permissions ON RepoPermission;
CREATE TRIGGER audit_repo_permissions
AFTER INSERT OR UPDATE OR DELETE ON RepoPermission
FOR EACH ROW EXECUTE FUNCTION log_permission_change();

-- ==========================================
-- 4. BUSINESS LOGIC TRIGGERS
-- ==========================================

-- Automatically grant 'Owner' permission when a repo is created
CREATE OR REPLACE FUNCTION grant_owner_permission()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO RepoPermission (user_id, repo_id, permission)
    VALUES (NEW.owner_id, NEW.repo_id, 'Owner')
    ON CONFLICT (user_id, repo_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_grant_owner_permission ON REPOSITORY;
CREATE TRIGGER tr_grant_owner_permission
AFTER INSERT ON REPOSITORY
FOR EACH ROW EXECUTE FUNCTION grant_owner_permission();

-- Delete permissions when a repo is deleted
CREATE OR REPLACE FUNCTION delete_repo_permissions()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM RepoPermission WHERE repo_id = OLD.repo_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_delete_repo_permissions ON REPOSITORY;
CREATE TRIGGER tr_delete_repo_permissions
BEFORE DELETE ON REPOSITORY
FOR EACH ROW EXECUTE FUNCTION delete_repo_permissions();

-- ==========================================
-- 5. STORED PROCEDURES (Transactions)
-- ==========================================

-- Function to create a new repository (replaces complex JS logic)
CREATE OR REPLACE FUNCTION create_new_repository(
    repo_name VARCHAR(50),
    repo_description VARCHAR(100),
    owner_id_in INT
)
RETURNS INT AS $$
DECLARE
    new_repo_id INT;
BEGIN
    INSERT INTO REPOSITORY (name, description, owner_id)
    VALUES (repo_name, repo_description, owner_id_in)
    RETURNING repo_id INTO new_repo_id;

    -- Initial Tree creation is handled by JS currently, 
    -- but this function handles the Repo + Permission (via trigger)
    
    RETURN new_repo_id;
END;
$$ LANGUAGE plpgsql;

-- Procedure to Add Collaborator (Handles User Lookup + Insert + Validation)
CREATE OR REPLACE PROCEDURE add_collaborator_proc(
    p_repo_id INT,
    p_user_name VARCHAR,
    p_permission VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_user_id INT;
BEGIN
    -- 1. Find the User ID
    SELECT user_id INTO v_user_id FROM users WHERE user_name = p_user_name;
    
    -- 2. Validation
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_user_name;
    END IF;

    -- 3. Insert or Update Permission
    INSERT INTO repopermission (user_id, repo_id, permission)
    VALUES (v_user_id, p_repo_id, p_permission)
    ON CONFLICT (user_id, repo_id) 
    DO UPDATE SET permission = p_permission;
END;
$$;

-- ==========================================
-- 6. QUERY FUNCTIONS (Complex Reads)
-- ==========================================

-- Function to recursively get all files for a tree
CREATE OR REPLACE FUNCTION get_file_tree(root_id INT)
RETURNS TABLE (
    tree_id INT, 
    name VARCHAR, 
    mode VARCHAR, 
    child_tree_id INT, 
    blob_id INT, 
    blob_hash VARCHAR, 
    blob_size INT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE file_tree AS (
        SELECT te.tree_id, te.name, te.mode, te.child_tree_id, te.blob_id
        FROM tree_entry te
        WHERE te.tree_id = root_id
        
        UNION ALL
        
        SELECT te.tree_id, te.name, te.mode, te.child_tree_id, te.blob_id
        FROM tree_entry te
        INNER JOIN file_tree ft ON te.tree_id = ft.child_tree_id
    )
    SELECT 
        ft.tree_id, ft.name, ft.mode, ft.child_tree_id, ft.blob_id, 
        b.hash, b.size
    FROM file_tree ft
    LEFT JOIN blob b ON ft.blob_id = b.blob_id;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 7. ROLLBACK PROCEDURE
-- ==========================================

-- Procedure to Rollback (Restore) a version
CREATE OR REPLACE PROCEDURE restore_commit_proc(
    p_repo_id INT,
    p_user_id INT,
    p_commit_id_to_restore INT,
    p_new_commit_hash VARCHAR,
    p_message VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_tree_id INT;
BEGIN
    -- 1. Get the Tree ID from the old commit
    SELECT tree_id INTO v_old_tree_id 
    FROM Commit 
    WHERE commit_id = p_commit_id_to_restore;

    IF v_old_tree_id IS NULL THEN
        RAISE EXCEPTION 'Commit % not found', p_commit_id_to_restore;
    END IF;

    -- 2. Create a NEW commit pointing to that OLD tree
    INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message)
    VALUES (p_new_commit_hash, p_repo_id, v_old_tree_id, p_user_id, p_message);
END;
$$;

CREATE OR REPLACE FUNCTION get_diff_manifest(root_id INT)
RETURNS TABLE (
    file_path TEXT, 
    blob_hash VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE walker AS (
        SELECT 
            te.name::TEXT as path, 
            te.mode, 
            te.child_tree_id, 
            te.blob_id
        FROM tree_entry te
        WHERE te.tree_id = root_id

        UNION ALL

        SELECT 
            (w.path || '/' || te.name)::TEXT, 
            te.mode, 
            te.child_tree_id, 
            te.blob_id
        FROM tree_entry te
        JOIN walker w ON te.tree_id = w.child_tree_id
    )
    SELECT w.path, b.hash
    FROM walker w
    LEFT JOIN blob b ON w.blob_id = b.blob_id
    WHERE w.mode = 'blob';
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 8. ROLLBACK REQUESTS (Workflow)
-- ==========================================

CREATE TABLE IF NOT EXISTS Rollback_Request (
    request_id SERIAL PRIMARY KEY,
    repo_id INT REFERENCES REPOSITORY(repo_id) ON DELETE CASCADE,
    commit_id INT REFERENCES Commit(commit_id), -- The commit they want to go back to
    requester_id INT REFERENCES users(user_id),
    status VARCHAR(20) DEFAULT 'Pending', -- Pending, Approved, Rejected
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);






CREATE OR REPLACE FUNCTION delete_repository_proc(p_repo_id INT)
RETURNS TABLE (deleted_content_path TEXT)
LANGUAGE plpgsql AS
$$
DECLARE
    b_record RECORD;
    ids_to_delete INT[] := ARRAY[]::INT[]; -- Array to collect blob IDs for DB deletion
BEGIN
    -- Ensure repo exists; else raise exception
    IF NOT EXISTS (SELECT 1 FROM repository WHERE repo_id = p_repo_id) THEN
        RAISE EXCEPTION 'Repository % not found', p_repo_id;
    END IF;

    -- 1) Collect content_paths and blob_ids of blobs that are referenced only by this repo.
    FOR b_record IN
      SELECT bl.blob_id, bl.content_path -- FIX: Selecting blob_id for array collection
      FROM blob bl
      WHERE bl.blob_id IN (
        SELECT te.blob_id
        FROM tree_entry te
        JOIN tree t ON te.tree_id = t.tree_id
        WHERE t.repo_id = p_repo_id AND te.blob_id IS NOT NULL
      )
      AND NOT EXISTS (
        -- ensure no other repo references this blob through tree_entry -> tree
        SELECT 1 FROM tree_entry te2
        JOIN tree t2 ON te2.tree_id = t2.tree_id
        WHERE te2.blob_id = bl.blob_id
          AND t2.repo_id <> p_repo_id
      )
    LOOP
        deleted_content_path := b_record.content_path;
        RETURN NEXT;
        -- Collect the ID for database deletion (after the physical file is removed by the server)
        ids_to_delete := array_append(ids_to_delete, b_record.blob_id);
    END LOOP;

    -- 2) Delete commit-parent links for commits of this repo
    DELETE FROM Commit_Parent
    WHERE commit_id IN (SELECT commit_id FROM Commit WHERE repo_id = p_repo_id)
       OR parent_commit IN (SELECT commit_id FROM Commit WHERE repo_id = p_repo_id);

    -- 3) Delete commits belonging to this repo
    DELETE FROM Commit WHERE repo_id = p_repo_id;

    -- 4) Delete tree entries belonging to trees of this repo
    -- This MUST happen BEFORE deleting the referenced Blob records (Step 5).
    DELETE FROM Tree_Entry
    WHERE tree_id IN (SELECT tree_id FROM Tree WHERE repo_id = p_repo_id);

    -- 5) Delete the collected Blob records from the database
    -- FIX: Moved to this position to satisfy the FK constraint from Tree_Entry.
    DELETE FROM Blob
    WHERE blob_id = ANY(ids_to_delete);

    -- 6) Delete trees belonging to this repo
    DELETE FROM Tree WHERE repo_id = p_repo_id;

    -- 7) Delete permissions for this repo
    DELETE FROM RepoPermission WHERE repo_id = p_repo_id;

    -- 8) Delete the repository itself
    DELETE FROM REPOSITORY WHERE repo_id = p_repo_id;

    -- 9) Delete orphaned blobs from DB (final cleanup for truly unreferenced records)
    DELETE FROM Blob b
    WHERE NOT EXISTS (SELECT 1 FROM Tree_Entry te WHERE te.blob_id = b.blob_id);

    RETURN;
END;
$$;