# Contributing to HumanLayer

If you're looking to contribute, please:

- fork the repository.
- create a new branch for your feature.
- add your feature or improvement.
- send a pull request.
- we appreciate your input!

## Running Tests

Before submitting a pull request, please run the tests and linter:

```shell
make check test
```

Right now the linting rules are from an off-the-shelf config, and many rules are still being refined/removed. Well-justified per-file or per-rule ignores are welcome.

You can run

```shell
make githooks
```

to install a git pre-push hook that will run the checks before pushing.
