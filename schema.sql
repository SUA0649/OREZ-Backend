/*
-- ALl of this is specific for POSTGRES DB
 To run the schema in docker and ensure all the tables are successfully created.
docker cp schema.sql {container_name}:/tmp/schema.sql -- copying the file from local to the docker environment
docker exec -it {container_name} psql -U {user_name} -d {DB_name} -f /schema.sql --This copies the schema to the database
to Ensure table creation 
docker exec -it {container_name} psql -U {user_name} -d {DB_name}
appdb#= \dt --Write this command in the psql cmd and then you'll see the table over there.  
*/

CREATE TABLE IF NOT EXISTS users( --OWNERS
    user_id serial primary key,
    user_name varchar(30) not null unique,
    password_hash varchar(255) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS REPOSITORY(
    repo_id serial primary key,
    name varchar(50) not null,
    description varchar(100) not null,
    owner_id int references users(user_id) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS RepoPermission(
    user_id int references users(user_id) not null,
    repo_id int references REPOSITORY(repo_id) not null,
    permission varchar(20) not null check (permission in ('Owner','Viewer','Contributor')),
    UNIQUE(user_id, repo_id)
);

CREATE TABLE IF NOT EXISTS Blob ( -- This is a pointer to each individual file.
    blob_id serial primary key,
    hash varchar(100) not null unique,
    content_path varchar(200) not null unique,
    size int not null, -- Not sure why I need this will explore later.
    created_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Tree(  -- This is similar to how a folder works, a tree is a folder which contains some contents.
    tree_id serial primary key,
    hash varchar(100) not null unique,
    repo_id int references REPOSITORY(repo_id) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS Tree_Entry( -- This table is used to link the tree and the blobs together.
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
    hash varchar(100) not null, -- The different hashes are to hide exactly where the file contents are stored.
    repo_id int references REPOSITORY(repo_id) not null,
    tree_id int references Tree(tree_id) not null, -- The not null is to ensure that at least root tree exists\
    owner_id int references users(user_id) not null,
    message varchar(100) not null,
    created_at TIMESTAMP default CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Commit_Parent( -- To Track the commits.
    parent_id serial primary key,
    commit_id int references Commit(commit_id) not null,
    parent_commit int references Commit(commit_id)
);


-- Function to create a new repository, its owner permission, and its initial root tree
CREATE OR REPLACE FUNCTION create_new_repository(
    repo_name VARCHAR(50),
    repo_description VARCHAR(100),
    owner_id_in INT
)
RETURNS INT AS $$
DECLARE
    new_repo_id INT;
    root_tree_id INT;
BEGIN
    -- 1. Create the Repository
    INSERT INTO REPOSITORY (name, description, owner_id)
    VALUES (repo_name, repo_description, owner_id_in)
    RETURNING repo_id INTO new_repo_id;

    -- 2. Add Owner Permission
    --Handled by trigger now
--    INSERT INTO RepoPermission (user_id, repo_id, permission)
--    VALUES (owner_id_in, new_repo_id, 'Owner');

    -- 3. Create initial Root Tree (using a placeholder hash for now)
    INSERT INTO Tree (hash, repo_id)
    VALUES (md5(random()::text), new_repo_id) -- Using md5(random()::text) for a quick unique hash
    RETURNING tree_id INTO root_tree_id;

    -- Return the ID of the new repository
    RETURN new_repo_id;
END;
$$ LANGUAGE plpgsql;


-- Function: Automatically grants 'Owner' permission upon repository creation.
CREATE OR REPLACE FUNCTION grant_owner_permission()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert the owner into RepoPermission with 'Owner' role.
    -- The new repository's details are in the 'NEW' record.
    INSERT INTO RepoPermission (user_id, repo_id, permission)
    VALUES (NEW.owner_id, NEW.repo_id, 'Owner')
    ON CONFLICT (user_id, repo_id) DO NOTHING; -- Prevents errors if permission is somehow already set
    
    RETURN NEW; -- Return the row being inserted into REPOSITORY
END;
$$ LANGUAGE plpgsql;

-- Trigger: Fires AFTER a row is inserted into REPOSITORY
CREATE TRIGGER tr_grant_owner_permission
AFTER INSERT ON REPOSITORY
FOR EACH ROW
EXECUTE FUNCTION grant_owner_permission();



-- Function: Deletes all associated permissions when a repository is deleted.
CREATE OR REPLACE FUNCTION delete_repo_permissions()
RETURNS TRIGGER AS $$
BEGIN
    -- Delete permissions associated with the deleted repository.
    -- The deleted repository's details are in the 'OLD' record.
    DELETE FROM RepoPermission WHERE repo_id = OLD.repo_id;
    
    RETURN OLD; -- Return the deleted row
END;
$$ LANGUAGE plpgsql;

-- Trigger: Fires BEFORE a row is deleted from REPOSITORY
CREATE TRIGGER tr_delete_repo_permissions
BEFORE DELETE ON REPOSITORY
FOR EACH ROW
EXECUTE FUNCTION delete_repo_permissions();


-- Function: Updates the timestamp when a RepoPermission record is modified.
CREATE OR REPLACE FUNCTION update_permission_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Set the created_at to the current timestamp
    NEW.created_at = CURRENT_TIMESTAMP;
    
    RETURN NEW; -- Return the row being updated
END;
$$ LANGUAGE plpgsql;

-- Trigger: Fires BEFORE an UPDATE on RepoPermission
CREATE TRIGGER tr_update_permission_timestamp
BEFORE UPDATE ON RepoPermission
FOR EACH ROW
EXECUTE FUNCTION update_permission_timestamp();