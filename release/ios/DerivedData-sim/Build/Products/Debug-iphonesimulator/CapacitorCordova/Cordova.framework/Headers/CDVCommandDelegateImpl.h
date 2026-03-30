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

#import <UIKit/UIKit.h>
#import "CDVCommandDelegate.h"
#import <WebKit/WebKit.h>
#import "CDVPluginManager.h"

@class CDVViewController;
@class CDVCommandQueue;

@interface CDVCommandDelegateImpl : NSObject <CDVCommandDelegate>{
    @private
    __weak WKWebView* _webView;
    __weak CDVPluginManager* _manager;
    NSRegularExpression* _callbackIdPattern;
    @protected
    __weak CDVCommandQueue* _commandQueue;
    BOOL _delayResponses;
}
- (id)initWithWebView:(WKWebView*)webView pluginManager:(CDVPluginManager *)manager;
- (void)flushCommandQueueWithDelayedJs;
@end
