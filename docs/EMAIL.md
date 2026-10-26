# Sending email (sign-in codes and announcements)

immichset can email clients a sign-in code and send announcements to your contacts. It sends through **Resend**, a service
that delivers email for you. Email is optional; galleries work without it (use a password instead).

## What it costs

Resend's free plan allows 100 emails a day and 3,000 a month. That is plenty to start. Check their site for current limits.

## Set it up

1. **Make an account** at resend.com.
2. **Add your domain** (Domains › Add domain), the same kind of name as `yourstudio.com`. Resend shows a few DNS records.
3. **Add those records** where you manage your domain's DNS (at Cloudflare: your domain › DNS › Add record). It can take a few
   minutes to an hour to verify. Resend shows a green "Verified" when ready.
4. **Make an API key** (API Keys › Create, "Sending access") and copy it.
5. In immichset's setup page (**Email** step) or **Connections**, paste the key and enter the **From** address, for example
   `hello@yourstudio.com`. Press **Send test email** and check your inbox (and spam folder).

## If the test email doesn't arrive

- The domain isn't verified yet; wait and check Resend's Domains page.
- The From address must be on the verified domain.
- Check spam. Brand-new domains are sometimes filtered at first; mark it "not spam".

## Sending announcements: the basics

- Only email people who gave you their address or are your clients.
- Keep the unsubscribe link immichset adds. Laws such as CAN-SPAM (US) and GDPR (EU) expect it.
- Put your real name and a way to reach you in the message.

This is general information, not legal advice. Check the rules where you and your clients live.
