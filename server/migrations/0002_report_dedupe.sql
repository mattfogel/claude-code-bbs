-- One report per user per item, so a loop of reports cannot flood the table.
DELETE FROM reports WHERE id NOT IN (SELECT MIN(id) FROM reports GROUP BY reporter_id, kind, item_id);
CREATE UNIQUE INDEX reports_once ON reports (reporter_id, kind, item_id);
