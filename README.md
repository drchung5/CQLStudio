# CQLStudio

CQLStudio is a lightweight CQL notebook/workbench inspired by DataStax Studio.

This milestone provides a functional vertical slice with:
- Connection form for Cassandra-compatible clusters
- Backend-owned Cassandra session lifecycle
- CQL workbench with Monaco editor
- Schema browser (non-system keyspaces)
- Query result rendering for SELECT and non-SELECT statements

## Tech Stack

- TypeScript
- React (frontend)
- Node.js + Express (backend)
- `cassandra-driver` for Cassandra connectivity
- Monaco Editor for CQL editing

## Project Structure

- `apps/backend`: Node.js API and Cassandra services
- `apps/frontend`: React UI and workbench
- `packages/shared`: Shared TypeScript API contracts

## Security Notes

- Passwords are never logged.
- Passwords are never returned by backend APIs.
- Frontend never connects directly to Cassandra.
- Backend owns all Cassandra connections.

## Prerequisites

- Node.js 20+
- npm 10+
- Access to a Cassandra, DSE, HCD, or Astra DB CQL endpoint

## Quick Start

1. Copy `.env.example` to `.env` and adjust values as needed.
2. Install dependencies:
   - `npm install`
3. Run in development mode:
   - `npm run dev`
4. Open the frontend at `http://localhost:5173`.

## Scripts

- `npm run dev`: Run frontend and backend together
- `npm run build`: Build all packages
- `npm run typecheck`: Run TypeScript checks
- `npm run start`: Start backend from built output

## Milestone Scope

Included:
- Single editor workbench (future notebook-cell-ready structure)
- Schema browser with keyspace/table/column tree
- Cmd+Enter and Ctrl+Enter to execute CQL

Not included yet:
- Charts
- Query history
- Astra Secure Connect Bundle support
- Gremlin / Graph functionality