# Comment XML Format

Comments are formatted as XML blocks for LLM consumption.

## Single Comment

```xml
<comment>
Author Name: The comment text here
</comment>
```

## With Block Context

```xml
<comment>
  | previous line
> | commented block (marked with >)
  | next line

Author Name: The comment text here
</comment>
```

## With Replies

```xml
<comment>
> | some code

Alice: This needs refactoring
  Bob: I agree, let's use a helper function
  Alice: Good idea
</comment>
```

## Resolved Comments

Resolved comments include `[RESOLVED]` tag:

```xml
<comment>
Alice [RESOLVED]: Fixed the typo
</comment>
```
