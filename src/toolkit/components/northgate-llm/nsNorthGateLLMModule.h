/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsNorthGateLLMModule_h
#define nsNorthGateLLMModule_h

#include "nsID.h"

// Implemented in Rust (toolkit/components/northgate-llm/src/lib.rs).
extern "C" {
nsresult nsNorthGateLLMConstructor(REFNSIID aIID, void** aResult);
}  // extern "C"

#endif  // defined nsNorthGateLLMModule_h
