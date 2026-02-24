// Convenience methods for bridging to/from JavaScript types. Deliberately hidden from
// Swift by omission (to avoid collisions with Swift protocols), use
// `#import <Capacitor/CAPBridgedJSTypes.h>` if working in Objective-C.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor-Swift.h>

@protocol BridgedJSValueContainerImplementation <NSObject>
@required
- (NSString * _Nullable)getString:(NSString * _Nonnull)key defaultValue:(NSString * _Nullable)defaultValue;
- (NSDate * _Nullable)getDate:(NSString * _Nonnull)key defaultValue:(NSDate * _Nullable)defaultValue;
- (NSDictionary * _Nullable)getObject:(NSString * _Nonnull)key defaultValue:(NSDictionary * _Nullable)defaultValue;
- (NSNumber * _Nullable)getNumber:(NSString * _Nonnull)key defaultValue:(NSNumber * _Nullable)defaultValue;
- (BOOL)getBool:(NSString * _Nonnull)key defaultValue:(BOOL)defaultValue;
@end

@interface CAPPluginCall (BridgedJSProtocol) <BridgedJSValueContainerImplementation>
@end
