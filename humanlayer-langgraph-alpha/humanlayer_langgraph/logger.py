import sys

from loguru import logger


class LoggerFactory:
    """Factory class for creating and configuring loggers.

    Implements the LoggerInterface to provide standardized logging functionality.
    """

    def __init__(self):
        """Initialize the logger factory with a configured logger instance."""
        self.logger = self.setup_logger()

    @staticmethod
    def setup_logger():
        """Configure and set up a new logger instance.

        Returns:
            logger: Configured loguru logger instance with custom formatting
        """
        # Remove any existing handlers
        logger.remove()

        # Add custom formatted handler
        logger.add(
            sys.stdout,
            format="<blue>{time:HH:mm:ss}</blue> | <green>{message}</green>",
            colorize=True,
            level="INFO",
        )

        return logger

    def info(self, message: str):
        """Log an info level message.

        Args:
            message (str): The message to log
        """
        self.logger.info(message)

    def debug(self, message: str):
        """Log a debug level message.

        Args:
            message (str): The message to log
        """
        self.logger.debug(message)

    def success(self, message: str):
        """Log a success level message.

        Args:
            message (str): The message to log
        """
        self.logger.success(message)

    def error(self, message: str):
        """Log an error level message.

        Args:
            message (str): The message to log
        """
        self.logger.error(message)

    def warning(self, message: str):
        """Log a warning level message.

        Args:
            message (str): The message to log
        """
        self.logger.warning(message)

    @staticmethod
    def get_logger():
        """Get a configured logger instance.

        Returns:
            logger: Configured loguru logger instance
        """
        return LoggerFactory.setup_logger()
