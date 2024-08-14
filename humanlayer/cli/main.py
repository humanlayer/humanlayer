import os

import click
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.getcwd(), ".env"))


@click.group(name="humanlayer")
def cli() -> None:
    pass


@cli.command(
    "check",
    help="""Validate your installation""",
)
def cli_check() -> None:
    click.echo("Your installation is valid!")


if __name__ == "__main__":
    cli()
