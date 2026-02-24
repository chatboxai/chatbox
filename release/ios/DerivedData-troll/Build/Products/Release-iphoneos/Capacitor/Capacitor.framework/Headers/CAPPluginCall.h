#import <Foundation/Foundation.h>

@class CAPPluginCall;
@class CAPPluginCallResult;
@class CAPPluginCallError;

typedef void(^CAPPluginCallSuccessHandler)(CAPPluginCallResult *result, CAPPluginCall* call);
typedef void(^CAPPluginCallErrorHandler)(CAPPluginCallError *error);

@interface CAPPluginCall : NSObject

@property (nonatomic, assign) BOOL isSaved DEPRECATED_MSG_ATTRIBUTE("Use 'keepAlive' instead.");
@property (nonatomic, assign) BOOL keepAlive;
@property (nonatomic, strong) NSString *callbackId;
@property (nonatomic, strong) NSString *methodName;
@property (nonatomic, strong) NSDictionary *options;
@property (nonatomic, copy) CAPPluginCallSuccessHandler successHandler;
@property (nonatomic, copy) CAPPluginCallErrorHandler errorHandler;

- (instancetype)initWithCallbackId:(NSString *)callbackId options:(NSDictionary *)options success:(CAPPluginCallSuccessHandler)success error:(CAPPluginCallErrorHandler)error DEPRECATED_MSG_ATTRIBUTE("Specify the method name as well.");

- (instancetype)initWithCallbackId:(NSString *)callbackId methodName:(NSString *)methodName options:(NSDictionary *)options success:(CAPPluginCallSuccessHandler)success error:(CAPPluginCallErrorHandler)error;

- (void)save DEPRECATED_MSG_ATTRIBUTE("Use the 'keepAlive' property instead.");
@end
