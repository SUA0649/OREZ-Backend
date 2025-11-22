# Use the official PostgreSQL image as the base image
FROM postgres:15-alpine

# Set environment variables for PostgreSQL
ENV POSTGRES_PASSWORD=123
ENV POSTGRES_DB=appdb
ENV POSTGRES_USER=orez

# Copy schema.sql into the container so it runs at initialization
COPY ./schema.sql /docker-entrypoint-initdb.d/schema.sql
