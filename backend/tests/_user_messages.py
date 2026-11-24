"""Mirror of the user-facing error messages the API returns, keyed by ErrorCode.

Source of truth is the routers: every constant message passed to ``AppError`` must
appear here, which test_endpoint_matrix.py enforces by scanning the source. When
you add or reword an error, update this file and the table in
docs/OBSERVABILITY.md in the same change.

* ``USER_FACING_MESSAGES``: codes with exactly one wording; matrix cells assert it
  verbatim. Every domain code belongs here (#87).
* ``VARIANT_MESSAGES``: generic codes raised with a message that names the failing
  action or resource. Only ``GENERIC_CODES`` may appear here.
* ``DYNAMIC_CODES``: generic codes whose message embeds request-specific text, so
  only the code is asserted.
* ``UNUSED_CODES``: reserved for planned work; nothing raises them yet.
"""

# Generic codes whose message and HTTP status depend on where they are raised.
# Every other code has one message and one status (docs/OBSERVABILITY.md,
# "User-facing messages").
GENERIC_CODES = {"FORBIDDEN", "INTERNAL_ERROR", "NOT_FOUND", "UNAUTHORIZED", "VALIDATION_FAILED"}

USER_FACING_MESSAGES = {
    "ADMIN_CANNOT_CHANGE_OWN_ROLE": "Cannot change your own role.",
    "ADMIN_REQUIRED": "Admin access required.",
    "ADMIN_RESOLUTION_CREATOR_RESTRICTED": "You cannot resolve a market you created.",
    "AUTH_PROFILE_INCOMPLETE": "User profile not found. Please complete onboarding.",
    "BET_CREATOR_RESTRICTED": "You cannot bet on a market you created.",
    "BET_INSUFFICIENT_BALANCE": "Insufficient Tartan Coin balance.",
    "BET_INVALID_AMOUNT": "Bet amount must be positive.",
    "BET_INVALID_OPTION": "Invalid market option.",
    "CLAIM_ALREADY_TODAY": "Already claimed today.",
    "CLAIM_AT_BALANCE_CAP": "Balance is at or above the 5,000 coin daily claim cap.",
    "COMMUNITY_VOTE_CREATOR_RESTRICTED": "Market creators cannot cast community votes on their own market.",
    "COMMUNITY_VOTE_DUPLICATE": "You have already voted on this market's resolution.",
    "DISPUTE_ALREADY_FILED": "You have already submitted a concern for this market.",
    "DISPUTE_BETTOR_RESTRICTED": "Bettors cannot vote on disputes for markets they bet on.",
    "DISPUTE_CREATOR_RESTRICTED": "Market creators cannot file or vote on disputes for their own market.",
    "DISPUTE_NOT_FOUND": "No dispute found for this market.",
    "DISPUTE_VOTE_DUPLICATE": "You've already voted.",
    "FORBIDDEN": "Disputes can only be filed as yourself.",
    "MARKET_ALREADY_RESOLVED": "Market is already resolved.",
    "MARKET_CLOSE_DATE_PASSED": "Market close date has passed.",
    "MARKET_NOT_ADMIN_REVIEW": "Market is not in admin review.",
    "MARKET_NOT_BINARY": "Multiple-choice markets can only be resolved as ambiguous here.",
    "MARKET_NOT_CLOSED": "Market must be closed before it can be resolved.",
    "MARKET_NOT_FOUND": "Market not found.",
    "MARKET_NOT_MULTICHOICE": "Market is not a multichoice market.",
    "MARKET_NOT_OPEN": "Market is not open for betting.",
    "MARKET_NOT_PENDING_RESOLUTION": "Market is not in its resolution period.",
    "MARKET_NOT_PENDING_REVIEW": "Market is not pending review.",
    "NOTIFICATION_NOT_FOUND": "Notification not found.",
    "RESOLUTION_NOT_CREATOR": "Only the market creator can do this.",
    "RESOLUTION_WINDOW_EXPIRED": "The resolution window has expired.",
    "SUPER_ADMIN_REQUIRED": "Super admin access required.",
}

VARIANT_MESSAGES = {
    "INTERNAL_ERROR": {
        "Backroll failed.",
        "Failed to approve market.",
        "Failed to cast vote.",
        "Failed to claim.",
        "Failed to create market.",
        "Failed to file dispute.",
        "Failed to load badges.",
        "Failed to load community votes.",
        "Failed to load dispute submissions.",
        "Failed to place bet.",
        "Failed to propose resolution.",
        "Failed to resolve market.",
        "Failed to start community resolution.",
        "Failed to update profile",
        "Failed to update role.",
        "Failed to upsert profile",
        "Service temporarily unavailable.",
    },
    "NOT_FOUND": {"Market or user not found.", "Market, option, or user not found.", "User not found."},
    "UNAUTHORIZED": {"Invalid or expired token.", "Not authenticated."},
}

DYNAMIC_CODES = {
    "VALIDATION_FAILED": {
        "Andrew ID must not be empty.",
        "Display name contains unsupported characters. Use letters, numbers, spaces, periods, underscores, or hyphens.",
        "Display name must not be empty.",
        "Explanation must be 1 to 1000 characters.",
        "Invalid equipped_badge_id",
        "No fields to update",
        "Notes are required when denying a market.",
        "One or more equipped badge ids are invalid",
        "Role must be 'user' or 'admin'.",
    },
}

UNUSED_CODES = {"MARKET_NOT_DISPUTED", "RATE_LIMITED"}
