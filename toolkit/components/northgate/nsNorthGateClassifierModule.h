/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsNorthGateClassifierModule_h
#define nsNorthGateClassifierModule_h

#include "nsID.h"

// Implemented in Rust (toolkit/components/northgate/src/lib.rs).
extern "C" {
nsresult nsNorthGateClassifierConstructor(REFNSIID aIID, void** aResult);
}  // extern "C"

#endif  // defined nsNorthGateClassifierModule_h
