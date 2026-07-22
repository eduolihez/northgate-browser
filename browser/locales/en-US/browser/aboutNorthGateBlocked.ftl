# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

### The about:northgate-blocked phishing warning interstitial.

ngate-blocked-title = Warning: Possible phishing site
ngate-blocked-heading = This site may be trying to steal your information
ngate-blocked-lead = { -brand-short-name }’s on-device classifier flagged this page as a likely phishing attempt.

ngate-blocked-site-label = Site
ngate-blocked-risk-label = Estimated phishing risk
# Variables:
#   $percent (number) - Estimated phishing probability, 0-100.
ngate-blocked-risk-value = { $percent }%

ngate-blocked-explain = Phishing sites imitate real ones to trick you into entering passwords, payment details, or other personal information. This check ran entirely on your device.

ngate-blocked-back = Go back (recommended)
ngate-blocked-proceed = Ignore the warning and continue
