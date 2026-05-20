-- Support fractional costs in credits_ledger
-- Change amount column from integer to numeric(10,3) to support fractional cents

-- First, drop the view that depends on the amount column
DROP VIEW IF EXISTS user_credit_balance;

-- The auto-top-up trigger references users.credits, so drop it before changing
-- the column type and recreate it after the dependent functions are refreshed.
DROP TRIGGER IF EXISTS auto_topup_trigger ON users;

-- Update the users.credits column to also support fractional values
ALTER TABLE users 
ALTER COLUMN credits TYPE numeric(10,3);

-- Now alter the credits_ledger amount column type
ALTER TABLE credits_ledger 
ALTER COLUMN amount TYPE numeric(10,3);

-- Recreate the user_credit_balance view with updated column types
CREATE VIEW user_credit_balance AS
SELECT 
  u.id as user_id,
  u.credits as current_balance,
  COALESCE(SUM(CASE WHEN cl.type IN ('stripe', 'manual') THEN cl.amount ELSE 0 END), 0) as total_purchased,
  COALESCE(SUM(CASE WHEN cl.type = 'spend' THEN ABS(cl.amount) ELSE 0 END), 0) as total_spent,
  COALESCE(SUM(CASE WHEN cl.type = 'refund' THEN cl.amount ELSE 0 END), 0) as total_refunded
FROM users u
LEFT JOIN credits_ledger cl ON u.id = cl.user_id
GROUP BY u.id, u.credits;

-- Update the refresh_user_balance function to handle numeric values
CREATE OR REPLACE FUNCTION refresh_user_balance() 
RETURNS trigger 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  -- Set application name to identify this as a system update
  PERFORM set_config('application_name', 'refresh_user_balance', true);
  
  UPDATE users SET credits = (
    SELECT COALESCE(SUM(amount), 0) 
    FROM credits_ledger 
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
  ) WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  
  -- Reset application name
  PERFORM set_config('application_name', '', true);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER auto_topup_trigger
  AFTER UPDATE OF credits ON users
  FOR EACH ROW
  WHEN (OLD.credits IS DISTINCT FROM NEW.credits)
  EXECUTE FUNCTION check_auto_topup_trigger();
