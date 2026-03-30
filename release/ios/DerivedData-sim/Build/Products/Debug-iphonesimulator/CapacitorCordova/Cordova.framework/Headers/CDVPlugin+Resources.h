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
#import "CDVPlugin.h"

@interface CDVPlugin (CDVPluginResources)

/*
 This will return the localized string for a key in a .bundle that is named the same as your class
 For example, if your plugin class was called Foo, and you have a Spanish localized strings file, it will
 try to load the desired key from Foo.bundle/es.lproj/Localizable.strings
 */
- (NSString*)pluginLocalizedString:(NSString*)key;

/*
 This will return the image for a name in a .bundle that is named the same as your class
 For example, if your plugin class was called Foo, and you have an image called "bar",
 it will try to load the image from Foo.bundle/bar.png (and appropriately named retina versions)
 */
- (UIImage*)pluginImageResource:(NSString*)name;

@end
