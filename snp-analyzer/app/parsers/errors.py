"""Parse failures the upload route reports with a stable machine-readable code.

They stay ValueError subclasses so every existing caller that catches
ValueError (detector, import paths, tests) keeps working unchanged.
"""


class UploadParseError(ValueError):
    code = "parse_failed"


class EdsNoMeasurementData(UploadParseError):
    """An .eds archive with no measured reads (QuantStudio or StepOne layout)."""

    code = "eds_no_measurement_data"
