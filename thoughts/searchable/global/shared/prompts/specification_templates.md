# Specification Document Templates

These templates show the expected format for specification documents created during specification recovery.

## 00_overview.md Template

```markdown
---
project_name: {project_name}
analyzed_date: {ISO_date}
analyzer: {user_name}
source_commit: {git_commit}
specification_version: 1.0.0
completeness: {percentage}
status: in_progress|complete
---

# {Project Name} - Complete Specification Overview

## Executive Summary

{High-level description of what this codebase does, its purpose, and key capabilities}

## Project Metadata

- **Repository Path**: {full_path}
- **Primary Language**: {language}
- **Total Files**: {count}
- **Total Lines of Code**: {count}
- **Last Analysis Update**: {date}

## Technology Stack

### Core Technologies
- **Language**: {language} {version}
- **Runtime**: {runtime} {version}
- **Framework**: {framework} {version}

### Build Tools
- {tool_name}: {purpose}

### Dependencies Summary
- Production Dependencies: {count}
- Development Dependencies: {count}
- Total External APIs: {count}

## Architecture Overview

### High-Level Architecture
{ASCII diagram or description of major components}

### Key Components
1. **{Component Name}**
   - Purpose: {description}
   - Location: `{path}`
   - Dependencies: {list}

### Entry Points
- `{file}`: {description}

## Directory Structure

```
{project_root}/
├── src/                    # Main source code
│   ├── api/               # API endpoints
│   ├── models/            # Data models
│   └── services/          # Business logic
├── tests/                 # Test suites
├── config/                # Configuration files
└── docs/                  # Documentation
```

## Specification Document Index

### Architecture Documents
- [`architecture/system_design.md`](architecture/system_design.md) - System design and patterns
- [`architecture/component_diagram.md`](architecture/component_diagram.md) - Component relationships

### Component Specifications
- [`components/api_spec.md`](components/api_spec.md) - API component details
- [`components/auth_spec.md`](components/auth_spec.md) - Authentication system

### Interface Documentation
- [`interfaces/rest_api.yaml`](interfaces/rest_api.yaml) - OpenAPI specification
- [`interfaces/events.md`](interfaces/events.md) - Event system documentation

### Data Specifications
- [`data_models/schemas.sql`](data_models/schemas.sql) - Database schemas
- [`data_models/entities.md`](data_models/entities.md) - Entity relationships

## Analysis Progress

### Completed
- [x] Directory structure mapping
- [x] Technology stack identification
- [x] Entry point analysis

### In Progress
- [ ] Component deep dive (60% complete)
- [ ] API documentation (40% complete)

### Pending
- [ ] Performance analysis
- [ ] Security audit
- [ ] Test coverage analysis

## Quick Start Guide

To recreate this project from specifications:

1. Set up the development environment using [`configuration/setup.md`](configuration/setup.md)
2. Implement core models from [`data_models/entities.md`](data_models/entities.md)
3. Build API layer following [`interfaces/rest_api.yaml`](interfaces/rest_api.yaml)
4. Implement business logic per [`components/`](components/) specifications
5. Configure using [`configuration/env_vars.md`](configuration/env_vars.md)
6. Run tests as described in [`testing/strategy.md`](testing/strategy.md)

## Open Questions

1. {Question about unclear functionality}
2. {Question about missing documentation}

## Next Steps

- Continue component analysis for {component}
- Document {specific_area} in more detail
- Verify {assumption} with additional analysis
```

## Component Specification Template

```markdown
---
component_name: {name}
component_type: service|controller|model|utility
location: {path}
analyzed_date: {ISO_date}
dependencies: [{list}]
dependents: [{list}]
test_coverage: {percentage}
---

# {Component Name} Specification

## Overview

**Purpose**: {Clear description of what this component does}
**Responsibility**: {What this component is responsible for}
**Location**: `{file_path}`

## Public API

### Exported Functions

#### `functionName(param1: Type, param2?: Type): ReturnType`

**Purpose**: {What this function does}
**Parameters**:
- `param1` (Type): {Description} - Required
- `param2` (Type): {Description} - Optional, defaults to {default}

**Returns**: {Description of return value}

**Throws**: 
- `ErrorType`: When {condition}

**Example**:
```javascript
const result = functionName("value", { option: true });
// Returns: { status: "success", data: {...} }
```

**Implementation Notes**:
- {Important implementation detail}
- Performance: O(n) time complexity
- Side effects: {Any side effects}

### Exported Classes

#### `ClassName`

**Purpose**: {What this class represents}

**Constructor**:
```typescript
constructor(options: ClassOptions)
```

**Methods**:

##### `methodName(param: Type): ReturnType`
- **Purpose**: {Description}
- **Access**: public|protected|private
- **Parameters**: {Description}
- **Returns**: {Description}
- **File Reference**: `{file}:{line}`

**Properties**:
- `propertyName` (Type): {Description}
- `_privateProperty` (Type): {Internal use for...}

## Internal Implementation

### Private Functions

#### `_helperFunction()`
- **Purpose**: {Internal helper for...}
- **Used by**: {List of functions that use this}
- **Algorithm**: {Brief description of algorithm}

### Design Patterns

- **Pattern Used**: {e.g., Singleton, Factory, Observer}
- **Rationale**: {Why this pattern was chosen}
- **Implementation Details**: {How it's implemented}

## Dependencies

### External Dependencies
- `express`: Used for {purpose}
- `lodash`: Functions used: `_.debounce`, `_.merge`

### Internal Dependencies
- `../models/User`: User model for {purpose}
- `../utils/validation`: Input validation functions

## State Management

### Component State
- **State Variables**: {List with descriptions}
- **State Mutations**: {How state can be changed}
- **State Persistence**: {If/how state is persisted}

## Error Handling

### Error Types
- `ValidationError`: Input validation failures
- `NotFoundError`: Resource not found
- `AuthorizationError`: Insufficient permissions

### Error Responses
```javascript
{
  error: {
    code: "VALIDATION_ERROR",
    message: "User-friendly message",
    details: { field: "specific error" }
  }
}
```

## Configuration

### Required Configuration
- `API_KEY`: External service API key
- `CACHE_TTL`: Cache time-to-live in seconds

### Optional Configuration
- `DEBUG_MODE`: Enable debug logging (default: false)
- `MAX_RETRIES`: Maximum retry attempts (default: 3)

## Performance Characteristics

- **Time Complexity**: O(n log n) for main operation
- **Space Complexity**: O(n) for data storage
- **Caching**: Results cached for {duration}
- **Rate Limiting**: {limits if applicable}

## Testing

### Test Coverage
- Unit Tests: {coverage}%
- Integration Tests: {coverage}%

### Key Test Scenarios
1. {Scenario description}
2. {Scenario description}

### Test File Location
- Unit tests: `{file_path}_test.js`
- Integration tests: `tests/integration/{name}.test.js`

## Security Considerations

- **Authentication**: {How it handles auth}
- **Authorization**: {Permission checks}
- **Input Validation**: {What's validated}
- **Sensitive Data**: {How it's handled}

## Future Considerations

- **Scalability**: {Notes on scaling}
- **Deprecations**: {Any deprecated features}
- **TODOs**: {List of TODOs found in code}

## Code Examples

### Basic Usage
```javascript
// Example showing typical usage
import { Component } from './component';

const instance = new Component({
  option1: 'value',
  option2: true
});

const result = await instance.process(data);
```

### Advanced Usage
```javascript
// Example showing advanced features
// ... code example ...
```

## Related Documentation

- Architecture: [`../../architecture/system_design.md`](../../architecture/system_design.md)
- API Usage: [`../../interfaces/api_examples.md`](../../interfaces/api_examples.md)
- Data Models: [`../../data_models/user_model.md`](../../data_models/user_model.md)
```

## API Specification Template (OpenAPI Format)

```yaml
openapi: 3.0.0
info:
  title: {API Name}
  description: {API Description}
  version: 1.0.0
  contact:
    name: API Support
    email: support@example.com

servers:
  - url: https://api.example.com/v1
    description: Production server
  - url: http://localhost:3000/v1
    description: Development server

paths:
  /users:
    get:
      summary: List all users
      description: Returns a paginated list of users
      operationId: listUsers
      tags:
        - Users
      parameters:
        - name: page
          in: query
          description: Page number
          required: false
          schema:
            type: integer
            default: 1
        - name: limit
          in: query
          description: Items per page
          required: false
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  users:
                    type: array
                    items:
                      $ref: '#/components/schemas/User'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
              example:
                users:
                  - id: "123"
                    name: "John Doe"
                    email: "john@example.com"
                pagination:
                  page: 1
                  limit: 20
                  total: 100
        '401':
          $ref: '#/components/responses/Unauthorized'
        '500':
          $ref: '#/components/responses/InternalError'

components:
  schemas:
    User:
      type: object
      required:
        - id
        - email
      properties:
        id:
          type: string
          description: Unique user identifier
        email:
          type: string
          format: email
          description: User's email address
        name:
          type: string
          description: User's full name
        createdAt:
          type: string
          format: date-time
          description: Account creation timestamp

    Pagination:
      type: object
      properties:
        page:
          type: integer
          description: Current page number
        limit:
          type: integer
          description: Items per page
        total:
          type: integer
          description: Total number of items

  responses:
    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

    InternalError:
      description: Internal server error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - bearerAuth: []
```

## Master Specification Template

```markdown
# {Project Name} - Master Specification

## Table of Contents

1. [Overview](00_overview.md)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Interfaces](#interfaces)
5. [Data Models](#data-models)
6. [Workflows](#workflows)
7. [Configuration](#configuration)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Implementation Guide](#implementation-guide)

## Quick Links

- [API Documentation](interfaces/api_spec.yaml)
- [Database Schema](data_models/schemas.sql)
- [Setup Guide](configuration/setup.md)
- [Architecture Diagrams](architecture/diagrams/)

## Implementation Checklist

### Phase 1: Foundation
- [ ] Set up development environment
- [ ] Initialize project structure
- [ ] Configure build tools
- [ ] Set up version control

### Phase 2: Core Implementation
- [ ] Implement data models
- [ ] Create database schema
- [ ] Build core business logic
- [ ] Implement API endpoints

### Phase 3: Integration
- [ ] Connect external services
- [ ] Implement authentication
- [ ] Set up message queues
- [ ] Configure caching

### Phase 4: Testing & Deployment
- [ ] Write unit tests
- [ ] Create integration tests
- [ ] Set up CI/CD pipeline
- [ ] Deploy to staging
- [ ] Performance testing
- [ ] Security audit
- [ ] Production deployment

## Verification

To verify the specification is complete:

1. Can a new developer understand the system?
2. Are all APIs fully documented?
3. Is every business rule captured?
4. Are all edge cases documented?
5. Can the system be recreated from these specs?

## Living Document

This specification is a living document. Updates should be made as the system evolves.

Last Updated: {date}
Version: {version}
```

## Usage Notes

1. All templates should include YAML frontmatter for metadata
2. Use relative links between documents
3. Include code examples wherever possible
4. Document both the "what" and the "why"
5. Keep specifications version controlled
6. Update completion percentages as analysis progresses
7. Cross-reference related documents
8. Include file:line references for traceability