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

CREATE TABLE IF NOT EXISTS tree_entry ( -- This table is used to link the tree and the blobs together.
    entry_id SERIAL PRIMARY KEY,
    tree_id INT NOT NULL REFERENCES tree(tree_id),
    name VARCHAR(100) NOT NULL,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('blob', 'tree')),
    blob_id INT REFERENCES blob(blob_id), --This could be null, consider an empty folder.
    child_tree_id INT REFERENCES tree(tree_id), -- This is something like addressing sub-folders
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

