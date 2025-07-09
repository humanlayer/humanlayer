# Specification Recovery Sub-Agent Templates

This file contains detailed prompts for sub-agents used in specification recovery. Each template is designed to extract maximum information from specific aspects of a codebase.

## 1. API Specification Agent

```
Analyze all APIs in {directory_path}:

1. Find all API endpoints (REST, GraphQL, RPC, WebSocket, etc.)
2. For each endpoint document:
   - HTTP method and path pattern
   - Request format:
     - Headers required
     - Path parameters
     - Query parameters  
     - Body schema (with examples)
   - Response format:
     - Status codes
     - Headers
     - Body schema for each status code
     - Error response formats
   - Authentication/authorization requirements
   - Rate limiting
   - Timeouts
   - Middleware applied
   - Validation rules
   - File:line reference

3. Extract:
   - API versioning strategy
   - Content negotiation
   - CORS policies
   - Request/response transformations
   - Pagination patterns
   - Filtering/sorting capabilities

4. Create OpenAPI/Swagger spec if possible

Return: Complete API documentation with examples and schemas
```

## 2. Database Schema Agent

```
Extract complete database specification from {directory_path}:

1. Find all database schemas/migrations
2. Document each table/collection:
   - Table name and purpose
   - Columns/fields:
     - Name
     - Data type
     - Constraints (NOT NULL, UNIQUE, etc.)
     - Default values
     - Indexes
   - Primary keys
   - Foreign key relationships
   - Triggers
   - Stored procedures
   - Views

3. Extract:
   - Migration history
   - Seed data patterns
   - Query patterns (find all queries)
   - Connection pooling configuration
   - Database-specific features used

4. Document relationships:
   - One-to-one
   - One-to-many
   - Many-to-many
   - Polymorphic relations

Return: Complete schema with ERD-ready information
```

## 3. State Management Agent

```
Analyze state management in {directory_path}:

1. Identify state management pattern (Redux, MobX, Context, etc.)
2. Document all state stores/contexts:
   - Store structure
   - Initial state
   - Actions/mutations
   - Reducers/updaters
   - Selectors/getters
   - Middleware/plugins

3. Track state flow:
   - Where state is created
   - How state is modified
   - Where state is consumed
   - Side effects triggered

4. Document:
   - Persistence strategies
   - State synchronization
   - Performance optimizations
   - State validation
   - State migration

Return: Complete state architecture documentation
```

## 4. Testing Strategy Agent

```
Extract testing approach from {directory_path}:

1. Identify testing frameworks and tools
2. Document test structure:
   - Unit tests
   - Integration tests
   - End-to-end tests
   - Performance tests
   - Security tests

3. For each test file:
   - What is being tested
   - Test cases covered
   - Mocking strategies
   - Fixtures/test data
   - Assertions used

4. Extract:
   - Coverage requirements
   - CI/CD test configuration
   - Test environment setup
   - Test data management

Return: Complete testing strategy and patterns
```

## 5. Configuration Extraction Agent

```
Document all configuration in {directory_path}:

1. Find all configuration files
2. Extract:
   - Environment variables (with defaults)
   - Configuration files (JSON, YAML, etc.)
   - Runtime configuration
   - Build-time configuration
   - Feature flags

3. Document for each config:
   - Name and purpose
   - Type and format
   - Valid values/ranges
   - Default value
   - Required vs optional
   - Environment-specific values
   - Validation rules

4. Configuration loading:
   - Load order
   - Override mechanisms
   - Hot-reload capabilities

Return: Complete configuration specification
```

## 6. Security Analysis Agent

```
Analyze security measures in {directory_path}:

1. Authentication mechanisms:
   - Auth providers
   - Token management
   - Session handling
   - Password policies

2. Authorization:
   - Permission models
   - Role definitions
   - Access control lists
   - Policy enforcement points

3. Security features:
   - Input validation
   - Output encoding
   - CSRF protection
   - SQL injection prevention
   - XSS prevention
   - Rate limiting
   - Encryption usage

4. Sensitive data handling:
   - PII identification
   - Encryption at rest
   - Encryption in transit
   - Key management
   - Audit logging

Return: Complete security architecture
```

## 7. Dependency Analysis Agent

```
Map all dependencies in {directory_path}:

1. External dependencies:
   - Package name and version
   - License
   - Purpose/usage
   - Security vulnerabilities
   - Update policy

2. Internal dependencies:
   - Module relationships
   - Circular dependencies
   - Dependency injection
   - Service locators

3. Build dependencies:
   - Build tools
   - Compilers/transpilers
   - Bundlers
   - Linters

4. Runtime dependencies:
   - System requirements
   - External services
   - Database versions
   - API dependencies

Return: Complete dependency graph and requirements
```

## 8. Error Handling Agent

```
Document error handling in {directory_path}:

1. Error types:
   - Custom error classes
   - Error codes
   - Error hierarchies

2. Error handling patterns:
   - Try-catch blocks
   - Error boundaries
   - Global error handlers
   - Async error handling

3. Error responses:
   - Error message formats
   - Stack trace handling
   - User-facing messages
   - Debug information

4. Recovery strategies:
   - Retry mechanisms
   - Fallback behaviors
   - Circuit breakers
   - Graceful degradation

Return: Complete error handling specification
```

## 9. Performance Optimization Agent

```
Analyze performance patterns in {directory_path}:

1. Caching strategies:
   - Cache types used
   - Cache keys
   - TTL policies
   - Cache invalidation

2. Optimization techniques:
   - Lazy loading
   - Code splitting
   - Memoization
   - Database query optimization

3. Performance monitoring:
   - Metrics collected
   - Performance budgets
   - Profiling tools
   - APM integration

4. Scalability patterns:
   - Load balancing
   - Horizontal scaling
   - Async processing
   - Queue systems

Return: Performance architecture documentation
```

## 10. Business Logic Extractor Agent

```
Extract business rules from {directory_path}:

1. Core business logic:
   - Business rules
   - Validation logic
   - Calculation formulas
   - Decision trees

2. Workflows:
   - Process flows
   - State transitions
   - Approval chains
   - Notifications

3. Domain models:
   - Entity definitions
   - Value objects
   - Aggregates
   - Domain events

4. Business constraints:
   - Invariants
   - Pre/post conditions
   - Business validations
   - Temporal rules

Return: Complete business logic specification
```

## Usage Instructions

When spawning sub-agents, combine multiple templates based on the codebase structure. For example:

```javascript
// For a Node.js API service
const agents = [
  apiSpecificationAgent,
  databaseSchemaAgent,
  configurationAgent,
  errorHandlingAgent,
  securityAnalysisAgent
];

// For a React frontend
const agents = [
  stateManagementAgent,
  componentAnalysisAgent,
  performanceOptimizationAgent,
  testingStrategyAgent
];
```

Each agent should work independently and return structured data that can be compiled into the final specification documents.