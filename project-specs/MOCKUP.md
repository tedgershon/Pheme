# Pheme Mockups

## Primary Mockup Doc

- [Pheme Figma](https://www.figma.com/design/NdiGQV05V5rLxcbI68zM3k/BananaGains?node-id=0-1&t=ST0YBo6jyCYWAoA5-1)

## Visual References

- `kalshi-top-market.png` — reference for hottest market hero display (graph, options, volume, description)
- `kalshi-trend.png` — reference for trending/top markets section (numbered list, market title, percentage, dominant choice)
- `github-icon.png` — reference for user profile dropdown (circular avatar, dropdown card with navigation)

## Views

### Existing Views (enhanced)
- Landing / home page — redesigned with hottest market hero, weekly leaderboard, trending/top tabs, then market grid
- Market list page — filtered to exclude pending_review and denied markets from public view
- Market detail page — enhanced with link display, multichoice options, community voting section
- Create market page — binary/multichoice toggle, link field, public/admin field distinction, style linting
- Portfolio page — updated coin claiming with 5,000 cap, pending market section
- Leaderboard page — badges displayed next to users with hover tooltips

### New Views
- Resolutions page (`/resolutions`) — markets in 24h resolution period with countdown timers and voting
- Admin dashboard (`/admin`) — landing page with navigation to review, stats, and user management
- Admin review page (`/admin/review`) — accordion tables for pending, approved, denied markets
- Admin statistics page (`/admin/stats`) — cumulative statistics (users, markets, trading volume)
- Admin user management page (`/admin/users`) — super admin only; search and role management
- Notifications page (`/notifications`) — list of in-app notifications with read/unread state
- Rewards page (`/rewards`) — badge progress across 5 tracks with tier descriptions

### New Components
- User menu dropdown — circular avatar with dropdown (replaces sign-in/sign-out button)
- Role toggle — admin/super admin can preview app as different roles
- Hottest market hero — large Kalshi-style market display with graph and pagination
- Weekly leaderboard — compact gains-based leaderboard with proportional progress bars
- Trending/top markets tabs — numbered market list (#1–#3) in Kalshi trend style
- Badge display — colored circles on leaderboard with hover tooltip for badge name
- Notification badge — red dot on avatar and count badge in dropdown for unread notifications
