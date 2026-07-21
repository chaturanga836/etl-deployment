"""Allow `python -m dtorch_cli` as an alternative to the `dtorch` entrypoint."""

from dtorch_cli.main import cli

if __name__ == "__main__":
    cli(prog_name="dtorch")
