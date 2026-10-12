import { getLang } from "@/lib/i18n";
import { policy } from "@/lib/policy";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Member terms of service / vendor application terms (used on the login page sign-up and the vendor application tab). The Chinese and English versions are maintained together; update both when the terms change.

export function MemberNotice() {
  return getLang() === "en" ? (
    <>
      <p className="font-bold text-accent-foreground text-base">Member Terms of Service</p>
      <p className="font-semibold">1. Membership</p>
      <p>Anyone who completes registration and agrees to these terms becomes a BunnBaa member and can browse menus and place orders online.</p>
      <p className="font-semibold">2. Account security</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Keep your account and password safe and do not let anyone else use them.</li>
        <li>If you notice unauthorised or unusual activity, contact platform support immediately.</li>
        <li>The platform is not responsible for losses caused by a member's own failure to protect their account.</li>
      </ul>
      <p className="font-semibold">3. Ordering rules</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>{cap(policy.serviceDays())}. You can {policy.bookingRange()}; <span className="font-semibold">{policy.cutoff()}</span> (a vendor may close earlier).</li>
        <li>Side-dish wishes are decided at cutoff. If a wish doesn't reach the minimum, you get the default side and the order still stands.</li>
        <li>If you have allergies or special dietary needs, note them on your order and confirm directly with the vendor.</li>
        <li><span className="font-semibold">{cap(policy.noShow())}</span>. On the pickup day you can also donate a meal yourself.</li>
      </ul>
      <p className="font-semibold">4. Cancellations and refunds</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>{cap(policy.cancel())}. A coupon used on the order is returned with its original expiry.</li>
        <li>{cap(policy.changeBeforeCutoff())}.</li>
        <li>{cap(policy.afterCutoff())}.</li>
        <li>{cap(policy.refunds())}.</li>
        <li>{cap(policy.disaster())}.</li>
        <li>{cap(policy.vendorFailed())}.</li>
        <li>Support: herzbaa@gmail.com</li>
      </ul>
      <p className="font-semibold">5. Personal data</p>
      <p>Personal data you provide (name, phone, school and department, etc.) is used only for ordering and contacting you, and is never disclosed or sold to third parties.</p>
      <p className="font-semibold">6. Changes to the service</p>
      <p>The platform may change the service or these terms at any time and will announce changes on the platform. Continuing to use the service means you accept the revised terms.</p>
    </>
  ) : (
    <>
      <p className="font-bold text-accent-foreground text-base">會員服務須知</p>
      <p className="font-semibold">一、會員資格</p>
      <p>凡完成會員註冊程序並同意本須知者，即取得飯飽 BunnBaa 會員資格，享有線上瀏覽菜單、下單訂餐等服務。</p>
      <p className="font-semibold">二、帳號安全</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>會員帳號及密碼請妥善保管，不得轉讓他人使用。</li>
        <li>如發現帳號遭盜用或異常，請立即聯繫平台客服。</li>
        <li>因會員自身疏失導致帳號外洩所造成之損失，平台不負相關責任。</li>
      </ul>
      <p className="font-semibold">三、訂餐規範</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>{policy.serviceDays()}。{policy.bookingRange()}，<span className="font-semibold">{policy.cutoff()}</span>（店家可提前截單）。</li>
        <li>配菜許願於截單時判定，未達最低量自動改為預設配菜，訂單照常成立。</li>
        <li>如對餐點有過敏或特殊飲食需求，請於備註欄位說明，並直接與店家確認。</li>
        <li><span className="font-semibold">{policy.noShow()}</span>；取餐當天也可以主動「捐為愛心餐」。</li>
      </ul>
      <p className="font-semibold">四、取消與退款政策</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>{policy.cancel()}；下單時使用的折價券退回並保留原到期日。</li>
        <li>{policy.changeBeforeCutoff()}。</li>
        <li>{policy.afterCutoff()}（現做餐點屬易腐敗商品，通訊交易解除權之例外）。</li>
        <li>{policy.refunds()}。</li>
        <li>{policy.disaster()}。</li>
        <li>{policy.vendorFailed()}。</li>
        <li>客服聯絡方式：herzbaa@gmail.com</li>
      </ul>
      <p className="font-semibold">五、個人資料保護</p>
      <p>會員所提供之個人資料（姓名、電話、學校科系等）僅用於訂餐服務及聯絡使用，不會對外揭露或販售給第三方。</p>
      <p className="font-semibold">六、服務變更</p>
      <p>平台保留隨時修改服務內容或本須知之權利，修改後將公告於平台。繼續使用服務即視為同意修訂後之條款。</p>
    </>
  );
}

export function VendorNotice() {
  return getLang() === "en" ? (
    <>
      <p className="font-bold text-warning-text text-base">Vendor Application Terms</p>
      <p className="font-semibold">1. Eligibility</p>
      <p>Any business legally permitted to sell food may apply to become a BunnBaa vendor. Applicants must provide valid contact details and store information for review.</p>
      <p className="font-semibold">2. Partner plan and fees</p>
      <div className="bg-warning-soft rounded-lg p-3 space-y-1">
        <p className="font-semibold text-warning-text">No monthly fee, no listing fee</p>
        <p>The platform takes a {policy.commission().pct}% commission on each meal sold, calculated on the amount the customer actually pays and deducted when your sales are paid out.</p>
        <p className="font-semibold text-warning-text mt-1">Add the {policy.commission().pct}% when you price</p>
        <p>Set your menu prices with the commission included (to net NT$100, list at NT${policy.commission().example}). The rate is announced in advance if it changes.</p>
      </div>
      <p className="font-semibold">3. Ending the partnership and account handling</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Vendors may ask to stop listing at any time by contacting the platform; orders already placed must still be served.</li>
        <li>After leaving, the account is <span className="font-semibold">suspended</span> and can't take new orders.</li>
        <li>While suspended, all store data, menus and order history are <span className="font-semibold">kept, not deleted</span>, for up to 2 years.</li>
        <li>To come back, contact the platform and everything picks up where it left off.</li>
        <li>Payouts are currently reconciled manually — for payout or commission questions contact herzbaa@gmail.com.</li>
      </ul>
      <p className="font-semibold">4. Service standards</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>Vendors must ensure their products comply with food safety and hygiene regulations.</li>
        <li>Menu items, prices and availability must be accurate and not misleading.</li>
        <li>Orders must be ready at the scheduled time; notify the platform and customers in advance of any problems.</li>
        <li>Vendors may not cancel confirmed orders without good reason; violations may affect the partnership.</li>
      </ul>
      <p className="font-semibold">5. Account management</p>
      <p>Vendor accounts are for the account holder only and may not be transferred or shared. Keep your password safe and notify the platform immediately if your account is compromised.</p>
      <p className="font-semibold">6. Use of information</p>
      <p>Store information you provide (store name, contact details) is shown publicly on the platform for customers.</p>
      <p className="font-semibold">7. Other</p>
      <p>The platform will announce any changes to these terms in advance. Continuing to use the platform means you accept the revised terms.</p>
    </>
  ) : (
    <>
      <p className="font-bold text-warning-text text-base">店家申請須知</p>
      <p className="font-semibold">一、申請資格</p>
      <p>凡具有合法食品販售資格之業者，均可申請成為飯飽 BunnBaa 平台店家。申請時須提供有效之聯絡方式及店家資訊，以供平台審核。</p>
      <p className="font-semibold">二、合作方案與收費</p>
      <div className="bg-warning-soft rounded-lg p-3 space-y-1">
        <p className="font-semibold text-warning-text">沒有月費、沒有上架費</p>
        <p>平台從每份賣出的餐點抽成 {policy.commission().pct}%，以消費者實付金額計算，於撥款時直接扣除。</p>
        <p className="font-semibold text-warning-text mt-1">定價時請加上 {policy.commission().pct}%</p>
        <p>菜單售價請把抽成算進去（想實收 100 元，售價訂 {policy.commission().example} 元）。抽成比例如有調整，平台會提前公告。</p>
      </div>
      <p className="font-semibold">三、終止合作與帳號處理</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>店家可隨時聯絡平台申請停止上架；已成立的訂單仍須照常出餐。</li>
        <li>終止後帳號將進入<span className="font-semibold">暫停狀態</span>，無法接新訂單。</li>
        <li>帳號暫停期間，所有店家資料、菜單、訂單紀錄<span className="font-semibold">均予保留，不會刪除</span>，保留期限為 2 年。</li>
        <li>如日後希望恢復使用，聯絡平台即可啟用帳號，原有資料完整延續。</li>
        <li>本平台目前採人工對帳方式撥款，如有撥款或抽成疑義請聯繫 herzbaa@gmail.com。</li>
      </ul>
      <p className="font-semibold">四、服務規範</p>
      <ul className="list-disc list-inside space-y-1 pl-1">
        <li>店家應確保所販售之商品符合食品安全衛生相關法規。</li>
        <li>店家應如實填寫菜單品項、價格及供應時間，不得有虛偽不實之情形。</li>
        <li>店家應依據訂單於指定時間完成出餐，如遇特殊狀況應提前通知平台及消費者。</li>
        <li>店家不得無故取消已確認之訂單，如有違反將影響合作資格。</li>
      </ul>
      <p className="font-semibold">五、帳號管理</p>
      <p>店家帳號限本人使用，不得轉讓或共用。帳號密碼請妥善保管，如發現帳號遭盜用請立即通知平台。</p>
      <p className="font-semibold">六、資料使用</p>
      <p>店家所提供之店家資訊（店名、聯絡方式）將公開顯示於平台，供消費者查閱。</p>
      <p className="font-semibold">七、其他</p>
      <p>本須知如有修訂，平台將提前公告。繼續使用平台服務即視為同意修訂後之條款。</p>
    </>
  );
}
