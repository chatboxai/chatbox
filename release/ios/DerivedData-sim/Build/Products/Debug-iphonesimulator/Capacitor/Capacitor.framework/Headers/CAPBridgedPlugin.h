#import "CAPPluginMethod.h"

#if defined(__cplusplus)
#define CAP_EXTERN extern "C" __attribute__((visibility("default")))
#else
#define CAP_EXTERN extern __attribute__((visibility("default")))
#endif

#define CAPPluginReturnNone @"none"
#define CAPPluginReturnCallback @"callback"
#define CAPPluginReturnPromise @"promise"

@class CAPPluginCall;
@class CAPPlugin;

@protocol CAPBridgedPlugin <NSObject>
@property (nonnull, readonly) NSString *identifier;
@property (nonnull, readonly) NSString *jsName;
@property (nonnull, readonly) NSArray<CAPPluginMethod *> *pluginMethods;
@end

#define CAP_PLUGIN_CONFIG(plugin_id, js_name) \
- (NSString *)identifier { return @#plugin_id; } \
- (NSString *)jsName { return @js_name; }
#define CAP_PLUGIN_METHOD(method_name, method_return_type) \
[methods addObject:[[CAPPluginMethod alloc] initWithName:@#method_name returnType:method_return_type]]

#define CAP_PLUGIN(objc_name, js_name, methods_body) \
@interface objc_name : NSObject \
@end \
@interface objc_name (CAPPluginCategory) <CAPBridgedPlugin> \
@end \
@implementation objc_name (CAPPluginCategory) \
- (NSArray *)pluginMethods { \
  NSMutableArray *methods = [NSMutableArray new]; \
  methods_body \
  return methods; \
} \
CAP_PLUGIN_CONFIG(objc_name, js_name) \
@end

