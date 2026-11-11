-- How the client usually pays (New client form "Preferred payment" was never saved).
ALTER TABLE "clients" ADD COLUMN "preferredPaymentMethod" "PaymentMethod";
