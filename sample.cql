CREATE KEYSPACE cqlstudio_test
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 1
};

USE cqlstudio_test;

DROP TABLE IF EXISTS cqlstudio_test.people;

CREATE TABLE cqlstudio_test.people (
    id int PRIMARY KEY,
    first_name text,
    last_name text,
    email text,
    age int,
    active boolean
);

INSERT INTO cqlstudio_test.people
(id, first_name, last_name, email, age, active)
VALUES
(1000, 'Alice', 'Johnson', 'alice@example.com', 34, true);

INSERT INTO cqlstudio_test.people
(id, first_name, last_name, email, age, active)
VALUES
(1001, 'Bob', 'Smith', 'bob@example.com', 47, true);

INSERT INTO cqlstudio_test.people
(id, first_name, last_name, email, age, active)
VALUES
(1002, 'Carol', 'Williams', 'carol@example.com', 29, false);

INSERT INTO cqlstudio_test.people
(id, first_name, last_name, email, age, active)
VALUES
(1003, 'David', 'Brown', 'david@example.com', 61, true);