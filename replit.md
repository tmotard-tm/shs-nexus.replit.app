# Overview

This is a full-stack admin platform built with React, TypeScript, and Express.js that manages access requests and API configurations. The application provides role-based interfaces for different user types (admin, requester, approver) to handle various types of requests including API access, Snowflake queries, system configurations, and user permissions. The platform features a modern UI built with shadcn/ui components and Tailwind CSS, with comprehensive request tracking and activity logging capabilities.

**Migration Status**: Successfully migrated from JSON file-based authentication to PostgreSQL database authentication (September 2025). All user credentials, session management, and authentication flows now use the database backend.

**Template Management System**: Added comprehensive template management system for superadmin users (September 2025). Provides full CRUD operations for workflow templates across all departments with security-first implementation including server-side ID generation, field whitelisting, and multi-layer access control.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for development tooling
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query for server state management and local React state
- **Routing**: Wouter for client-side routing
- **Forms**: React Hook Form with Zod validation
- **Authentication**: Context-based auth provider with localStorage persistence

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Validation**: Zod schemas shared between client and server
- **API Design**: RESTful endpoints with proper error handling and logging
- **Session Management**: Simple credential-based authentication (development setup)
- **Development**: Hot reload with Vite middleware integration

## Data Storage
- **Database**: PostgreSQL with Neon serverless driver
- **Schema**: Five main entities - users, requests, API configurations, and activity logs
- **Migrations**: Drizzle Kit for schema management and migrations
- **Storage Interface**: Abstract storage layer with in-memory implementation for development

## Authentication & Authorization
- **Authentication**: Username/password with simple session management
- **Authorization**: Role-based access control (admin, requester, approver)
- **Security**: Basic credential validation (suitable for development/demo)

## Key Features
- **Multi-role Dashboard**: Different interfaces based on user role
- **Request Management**: Full CRUD operations for various request types
- **API Configuration**: Management of external API connections and health monitoring
- **Template Management**: Comprehensive workflow template management for superadmin users (CRUD operations, search, filters, status management)
- **Activity Logging**: Comprehensive audit trail for all user actions
- **Real-time UI**: Dynamic updates with optimistic UI patterns

# External Dependencies

## Database & Storage
- **Neon Database**: Serverless PostgreSQL hosting
- **Drizzle ORM**: Type-safe database operations and migrations

## UI & Styling
- **shadcn/ui**: Complete component library built on Radix UI
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library

## Development & Build Tools
- **Vite**: Fast development server and build tool
- **TypeScript**: Type safety across the entire application
- **ESBuild**: Fast bundling for production builds
- **TanStack Query**: Server state management and caching

## Validation & Forms
- **Zod**: Runtime type validation and schema definition
- **React Hook Form**: Form state management and validation
- **Drizzle Zod**: Integration between Drizzle schemas and Zod validation

## Utilities
- **date-fns**: Date manipulation and formatting
- **clsx & tailwind-merge**: Conditional CSS class management
- **cmdk**: Command palette component