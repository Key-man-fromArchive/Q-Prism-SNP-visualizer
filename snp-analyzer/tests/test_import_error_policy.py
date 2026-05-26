from app.import_errors import ImportErrorCode, recovery_policy_for_code


def test_import_error_policy_classifies_recoverable_mapping_errors():
    recoverable_codes = [
        ImportErrorCode.MAPPING_CONFIG_REQUIRED,
        ImportErrorCode.MISSING_FIELD,
        ImportErrorCode.MALFORMED_WELL,
        ImportErrorCode.DUPLICATE_ROLE_BINDING,
        ImportErrorCode.MISSING_REQUIRED_ROLE,
        ImportErrorCode.MISSING_NORMALIZATION_CHANNEL,
        ImportErrorCode.DECIMAL_SEPARATOR_MISMATCH,
    ]

    for code in recoverable_codes:
        policy = recovery_policy_for_code(code)
        assert policy.recoverable is True
        assert policy.message


def test_import_error_policy_blocks_unsafe_or_non_curve_data():
    blocking_codes = [
        ImportErrorCode.UNSUPPORTED_CONTENT,
        ImportErrorCode.CQ_ENDPOINT_ONLY,
        ImportErrorCode.DUPLICATE_READING,
        ImportErrorCode.INCONSISTENT_CYCLE_COUNT,
        ImportErrorCode.FORMULA_AS_RFU,
        ImportErrorCode.FILE_LIMIT_EXCEEDED,
        ImportErrorCode.INVALID_NUMERIC_VALUE,
    ]

    for code in blocking_codes:
        policy = recovery_policy_for_code(code)
        assert policy.recoverable is False
        assert policy.message
