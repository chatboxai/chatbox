/*
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
 */

#define __CORDOVA_IOS__

#define __CORDOVA_0_9_6 906
#define __CORDOVA_1_0_0 10000
#define __CORDOVA_1_1_0 10100
#define __CORDOVA_1_2_0 10200
#define __CORDOVA_1_3_0 10300
#define __CORDOVA_1_4_0 10400
#define __CORDOVA_1_4_1 10401
#define __CORDOVA_1_5_0 10500
#define __CORDOVA_1_6_0 10600
#define __CORDOVA_1_6_1 10601
#define __CORDOVA_1_7_0 10700
#define __CORDOVA_1_8_0 10800
#define __CORDOVA_1_8_1 10801
#define __CORDOVA_1_9_0 10900
#define __CORDOVA_2_0_0 20000
#define __CORDOVA_2_1_0 20100
#define __CORDOVA_2_2_0 20200
#define __CORDOVA_2_3_0 20300
#define __CORDOVA_2_4_0 20400
#define __CORDOVA_2_5_0 20500
#define __CORDOVA_2_6_0 20600
#define __CORDOVA_2_7_0 20700
#define __CORDOVA_2_8_0 20800
#define __CORDOVA_2_9_0 20900
#define __CORDOVA_3_0_0 30000
#define __CORDOVA_3_1_0 30100
#define __CORDOVA_3_2_0 30200
#define __CORDOVA_3_3_0 30300
#define __CORDOVA_3_4_0 30400
#define __CORDOVA_3_4_1 30401
#define __CORDOVA_3_5_0 30500
#define __CORDOVA_3_6_0 30600
#define __CORDOVA_3_7_0 30700
#define __CORDOVA_3_8_0 30800
#define __CORDOVA_3_9_0 30900
#define __CORDOVA_3_9_1 30901
#define __CORDOVA_3_9_2 30902
#define __CORDOVA_4_0_0 40000
#define __CORDOVA_4_0_1 40001
#define __CORDOVA_4_1_0 40100
#define __CORDOVA_4_1_1 40101
#define __CORDOVA_4_2_0 40200
#define __CORDOVA_4_2_1 40201
#define __CORDOVA_4_3_0 40300
#define __CORDOVA_4_3_1 40301
#define __CORDOVA_4_4_0 40400
#define __CORDOVA_4_5_0 40500
#define __CORDOVA_4_5_1 40501
#define __CORDOVA_4_5_2 40502
#define __CORDOVA_4_5_4 40504
/* coho:next-version,insert-before */
#define __CORDOVA_NA 99999      /* not available */

/*
 #if CORDOVA_VERSION_MIN_REQUIRED >= __CORDOVA_4_0_0
    // do something when its at least 4.0.0
 #else
    // do something else (non 4.0.0)
 #endif
 */
#ifndef CORDOVA_VERSION_MIN_REQUIRED
    /* coho:next-version-min-required,replace-after */
    #define CORDOVA_VERSION_MIN_REQUIRED __CORDOVA_4_5_4
#endif

/*
 Returns YES if it is at least version specified as NSString(X)
 Usage:
     if (IsAtLeastiOSVersion(@"5.1")) {
         // do something for iOS 5.1 or greater
     }
 */
#define IsAtLeastiOSVersion(X) ([[[UIDevice currentDevice] systemVersion] compare:X options:NSNumericSearch] != NSOrderedAscending)

/* Return the string version of the decimal version */
#define CDV_VERSION [NSString stringWithFormat:@"%d.%d.%d", \
    (CORDOVA_VERSION_MIN_REQUIRED / 10000),                 \
    (CORDOVA_VERSION_MIN_REQUIRED % 10000) / 100,           \
    (CORDOVA_VERSION_MIN_REQUIRED % 10000) % 100]

// Enable this to log all exec() calls.
#define CDV_ENABLE_EXEC_LOGGING 0
#if CDV_ENABLE_EXEC_LOGGING
    #define CDV_EXEC_LOG NSLog
#else
    #define CDV_EXEC_LOG(...) do { \
} while (NO)
#endif
