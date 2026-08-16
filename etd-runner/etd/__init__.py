"""Enterprise Travel Direct (ETD) integration for Sears Home Services Fleet.

See API.md for the endpoint reference and verification status of every call.

    from etd import EtdClient
    etd = EtdClient()                 # reads are free, writes are blocked by default
    for u in etd.list_users():
        print(u["username"], u["userRole"])
"""
from .auth import Token, get_token, mint_token, load_credentials
from .client import (
    ACCOUNT_NAME,
    ACCOUNT_NUMBER,
    ACCOUNT_UID,
    BRANDS,
    COMPANY_ID,
    COMPANY_NAME,
    COMPANY_UID,
    DEFAULT_LANGUAGE,
    ROLE_ADMIN,
    ROLE_EMPLOYEE,
    DryRun,
    EtdClient,
    EtdError,
)

__all__ = [
    "EtdClient", "EtdError", "DryRun",
    "Token", "get_token", "mint_token", "load_credentials",
    "COMPANY_ID", "COMPANY_UID", "COMPANY_NAME", "DEFAULT_LANGUAGE",
    "ROLE_ADMIN", "ROLE_EMPLOYEE",
    "ACCOUNT_UID", "ACCOUNT_NUMBER", "ACCOUNT_NAME", "BRANDS",
]
__version__ = "0.1.0"
