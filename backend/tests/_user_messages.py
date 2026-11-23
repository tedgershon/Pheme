"""Mirror of the user-facing error messages the API returns, keyed by ErrorCode.

Source of truth is the routers: every constant message passed to ``AppError`` must
appear here, which test_endpoint_matrix.py enforces by scanning the source. When
you add or reword an error, update this file in the same change.

* ``USER_FACING_MESSAGES``: codes with exactly one wording; matrix cells assert it
  verbatim.
* ``VARIANT_MESSAGES``: codes deliberately raised with several wordings (the text
  names the failing rule). A cell may only see one of the listed messages.
* ``DYNAMIC_CODES``: codes whose message embeds request-specific text, so only the
  code is asserted.
* ``UNUSED_CODES``: reserved for planned work; nothing raises them yet.

Wording proposed for the UI in issue #17 is not mirrored here; reconcile it with
these actual messages there.
"""

USER_FACING_MESSAGES = {
    "ADMIN_CANNOT_CHANGE_OWN_ROLE": "Cannot change your own role.",
    "ADMIN_REQUIRED": "Admin access required.",
    "ADMIN_RESOLUTION_CREATOR_RESTRICTED": "You cannot resolve a market you created.",
    "BET_INSUFFICIENT_BALANCE": "Insufficient Tartan Coin balance.",
    "BET_INVALID_AMOUNT": "Bet amount must be positive.",
    "CLAIM_ALREADY_TODAY": "Already claimed today.",
    "CLAIM_AT_BALANCE_CAP": "Balance is at or above the 5,000 coin daily claim cap.",
    "COMMUNITY_VOTE_CREATOR_RESTRICTED": "Market creators cannot cast community votes on their own market.",
    "COMMUNITY_VOTE_DUPLICATE": "You have already voted on this market's resolution.",
    "DISPUTE_ALREADY_FILED": "You have already submitted a concern for this market.",
    "DISPUTE_BETTOR_RESTRICTED": "Bettors cannot vote on disputes for markets they bet on.",
    "DISPUTE_NOT_FOUND": "No dispute found for this market.",
    "DISPUTE_VOTE_DUPLICATE": "You've already voted.",
    "FORBIDDEN": "Disputes can only be filed as yourself.",
    "MARKET_NOT_ADMIN_REVIEW": "Market is not in admin review.",
    "MARKET_NOT_BINARY": "Multiple-choice markets can only be resolved as ambiguous here.",
    "MARKET_NOT_FOUND": "Market not found.",
    "MARKET_NOT_MULTICHOICE": "Market is not a multichoice market.",
    "MARKET_NOT_OPEN": "Market is not open for betting.",
    "MARKET_NOT_PENDING_REVIEW": "Market is not pending review.",
    "NOTIFICATION_NOT_FOUND": "Notification not found.",
    "RESOLUTION_NOT_CREATOR": "Only the market creator can do this.",
    "SUPER_ADMIN_REQUIRED": "Super admin access required.",
}

VARIANT_MESSAGES = {
    "AUTH_PROFILE_INCOMPLETE": {
        "User profile not found. Please complete onboarding.",
        "andrew_id must not be empty",
    },
    "BET_CREATOR_RESTRICTED": {
        "Market creators cannot place bets on their own markets.",
        "You cannot bet on a market you created.",
    },
    "BET_INVALID_OPTION": {"Invalid market option.", "Option does not belong to this market."},
    "DISPUTE_CREATOR_RESTRICTED": {
        "Market creator cannot file disputes.",
        "Market creator cannot vote on disputes.",
    },
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
    "MARKET_ALREADY_RESOLVED": {"Cannot backroll a resolved market.", "Market is already resolved."},
    "MARKET_CLOSE_DATE_PASSED": {
        "Market close date has passed. Pending markets are automatically denied and can no longer be updated.",
        "Market has closed.",
    },
    "MARKET_NOT_CLOSED": {
        "Community resolution can only be started for closed markets.",
        "Market must be closed before proposing resolution.",
    },
    "MARKET_NOT_PENDING_RESOLUTION": {
        "A creator proposal with a dispute deadline is required.",
        "Market is not in community resolution.",
        "Market is not in pending resolution.",
        "Market is not in the resolution period.",
    },
    "NOT_FOUND": {"Market or user not found.", "Market, option, or user not found.", "User not found."},
    "RESOLUTION_WINDOW_EXPIRED": {
        "Resolution voting window has expired.",
        "The resolution window has expired.",
    },
    "UNAUTHORIZED": {"Invalid or expired token.", "Not authenticated."},
}

DYNAMIC_CODES = {
    "VALIDATION_FAILED": {
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
