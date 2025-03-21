.PHONY: lint format test clean build publish publish-test

# Set variables
PACKAGE_NAME := humanlayer-langgraph
PYTHON := python3

# Default virtual environment
VENV_NAME := .venv
VENV_ACTIVATE := $(VENV_NAME)/bin/activate
VENV_PYTHON := $(VENV_NAME)/bin/python

# Python commands with venv
PIP := $(VENV_PYTHON) -m pip
BLACK := $(VENV_PYTHON) -m black
RUFF := $(VENV_PYTHON) -m ruff
MYPY := $(VENV_PYTHON) -m mypy
PYTEST := $(VENV_PYTHON) -m pytest
BUILD := $(VENV_PYTHON) -m build
TWINE := $(VENV_PYTHON) -m twine

# Create virtual environment
venv:
	$(PYTHON) -m venv $(VENV_NAME)
	$(PIP) install --upgrade pip
	$(PIP) install -e ".[dev]"

# Format code with black
format:
	$(BLACK) humanlayer_langgraph tests

# Run linters
lint:
	$(RUFF) check humanlayer_langgraph tests
	$(MYPY) humanlayer_langgraph

# Run tests
test:
	$(PYTEST) -xvs tests

# Clean build artifacts
clean:
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

# Build package
build: clean
	$(PIP) install -U build twine
	$(BUILD) --sdist --wheel .

# Publish to PyPI
publish: build
	$(TWINE) upload dist/*

# Publish to TestPyPI
publish-test: build
	$(TWINE) upload --repository-url https://test.pypi.org/legacy/ dist/*

# Development setup
setup-dev: venv
	$(PIP) install -e ".[dev]"